---
title: UI Visualization Plan
description: Historical planning and visualization notes for the OpenKeep interface.
---

# UI Visualization Plan: Intelligent Document Dashboard + Explorer

## Current State

The data model is rich. Each document carries:
- **Temporal**: `issueDate`, `dueDate`, `createdAt`, `processedAt`
- **Classification**: `correspondent`, `documentType`, `tags` (many-to-many)
- **Financial**: `amount`, `currency`
- **Processing**: `status`, `confidence`, `reviewStatus`, `embeddingStatus`
- **Content**: `fullText`, chunks with headings, vector embeddings (3072-dim halfvec)
- **Files**: thumbnails/previews via `storageKey`

The current `/documents` page is a flat paginated list with filter dropdowns and search. This works for ~50 docs but breaks down at scale because:
- No spatial/visual overview of the entire archive
- No temporal navigation (year filter is a dropdown, not visual)
- No way to discover document clusters or relationships
- Pagination hides the full picture
- No way to leverage embeddings for visual exploration

---

## Vision

A multi-surface document explorer with:
1. **Smart Dashboard** with widgets that automatically group docs by correspondent, generate AI summaries, and show a task/deadline list
2. **Correspondent Deep-Dive** — click "Adidas" to see: AI summary ("online shoe shop"), all 20 documents, total spend, doc type breakdown
3. **Semantic Galaxy** — 2D embedding visualization for discovery
4. **Timeline View** — chronological browsing across years
5. **Persistent sidebar** for faceted filtering across all views

Target scale: 500–5,000 documents.

---

## What Already Exists

| Capability | Status |
|---|---|
| Document CRUD, upload, processing | Done |
| OCR (6 providers), embeddings (4 providers) | Done |
| Correspondents, document types, tags (taxonomy) | Done |
| Semantic search (hybrid keyword + vector) | Done |
| Answer query (extractive, LLM-based) | Done |
| Facets API (years, correspondents, types, tags with counts) | Done |
| Due dates extracted during processing | Done |
| Review queue | Done |
| Basic dashboard with stats + recent docs | Done (needs redesign) |
| Flat document list with filter dropdowns | Done (needs upgrade) |

---

## Phase 1: Backend APIs (Foundation)

### 1a. Dashboard Insights API

**Endpoint**: `GET /api/dashboard/insights`

Returns everything the new dashboard needs in a single call:

```json
{
  "stats": {
    "totalDocuments": 2450,
    "pendingReview": 3,
    "documentTypesCount": 8,
    "correspondentsCount": 42
  },
  "topCorrespondents": [
    {
      "id": "uuid",
      "name": "Adidas",
      "slug": "adidas",
      "documentCount": 20,
      "totalAmount": 3240.00,
      "currency": "EUR",
      "latestDocDate": "2026-03-15",
      "documentTypes": [
        { "name": "Invoice", "count": 15 },
        { "name": "Receipt", "count": 3 },
        { "name": "Shipping", "count": 2 }
      ]
    }
  ],
  "upcomingDeadlines": [
    {
      "documentId": "uuid",
      "title": "Invoice #389",
      "dueDate": "2026-03-31",
      "amount": 149.99,
      "currency": "EUR",
      "correspondentName": "Adidas",
      "daysUntilDue": 9,
      "isOverdue": false
    }
  ],
  "overdueItems": [],
  "recentDocuments": [],
  "monthlyActivity": [
    { "month": "2026-03", "count": 12 },
    { "month": "2026-02", "count": 8 }
  ]
}
```

Implementation: Pure SQL aggregation queries on existing data. No new tables needed.

### 1b. DB Migration — Correspondent Summary

Add columns to the `correspondents` table:

```sql
ALTER TABLE correspondents
  ADD COLUMN summary TEXT,
  ADD COLUMN summary_generated_at TIMESTAMPTZ;
```

### 1c. Correspondent Insights API

**Endpoint**: `GET /api/correspondents/:id/insights`

Returns deep-dive data for a single correspondent:

```json
{
  "correspondent": { "id": "uuid", "name": "Adidas", "slug": "adidas" },
  "summary": "Adidas is an online retailer where you purchase shoes and sportswear. Your 20 documents span from Jan 2024 to Mar 2026, totaling €3,240 in invoices. Most documents are purchase receipts.",
  "stats": {
    "documentCount": 20,
    "totalAmount": 3240.00,
    "dateRange": { "from": "2024-01-15", "to": "2026-03-15" },
    "avgConfidence": 0.92
  },
  "documentTypeBreakdown": [
    { "name": "Invoice", "count": 15 },
    { "name": "Receipt", "count": 3 },
    { "name": "Shipping Confirmation", "count": 2 }
  ],
  "timeline": [
    { "month": "2026-03", "count": 3 },
    { "month": "2026-01", "count": 2 }
  ],
  "recentDocuments": [],
  "upcomingDeadlines": []
}
```

**AI Summary approach**: LLM-generated, cached in DB.
- On first request or when stale: call LLM (OpenAI/Gemini) with doc metadata + text snippets
- Store result in `correspondents.summary` + `correspondents.summary_generated_at`
- Regenerate when a new doc from that correspondent is processed
- The existing `answerQuery` pipeline can be adapted — feed it all docs from a correspondent and ask "Summarize who/what this correspondent is based on these documents"

### 1d. UMAP Projection API

**Endpoint**: `GET /api/documents/projection`

Computes 2D coordinates from 3072-dim embeddings:

```json
{
  "points": [
    {
      "documentId": "uuid",
      "x": 0.42,
      "y": 0.78,
      "title": "Invoice #389",
      "correspondentName": "Adidas",
      "typeName": "Invoice",
      "tags": ["shoes", "online-order"],
      "issueDate": "2026-03-15",
      "status": "ready"
    }
  ],
  "clusters": [
    { "centroidX": 0.4, "centroidY": 0.75, "label": "Adidas", "documentIds": ["..."] }
  ]
}
```

Implementation:
- Use `umap-js` (pure JS, no Python dependency)
- Load all document embeddings (average chunk embeddings per doc)
- Run UMAP to project to 2D, normalize to 0–1
- Cache result, recompute on doc changes (debounced)
- For 5,000 docs, UMAP takes ~2–5 seconds

### 1e. Timeline API

**Endpoint**: `GET /api/documents/timeline`

```json
{
  "years": [
    {
      "year": 2026,
      "count": 45,
      "months": [
        {
          "month": 3,
          "count": 12,
          "topCorrespondents": ["Adidas", "Nike"],
          "topTypes": ["Invoice", "Receipt"]
        }
      ]
    }
  ]
}
```

Pure SQL aggregation. Documents for a specific month loaded on-demand via existing list endpoint with `dateFrom`/`dateTo` filters.

---

## Phase 2: Dashboard UI (Reimagined `/`)

Replace the current dashboard with a widget-based layout:

```
+-----------------------------------------------------+
|  Dashboard                                           |
+------------------+----------------------------------+
|  STATS ROW       | Total: 2,450 | Review: 3 | ...   |
+------------------+----------------------------------+
|                  |                                    |
|  CORRESPONDENTS  |  UPCOMING DEADLINES               |
|  (card grid)     |  (task list)                       |
|                  |                                    |
|  [Adidas]  20    |  [] Invoice #389 - Mar 31 - €149  |
|  [Nike]    20    |  [] Tax Return  - Apr 15           |
|  [Tax Dept] 10   |  [] Rent Payment - Apr 1 - €800   |
|                  |                                    |
+------------------+----------------------------------+
|  RECENT ACTIVITY        |  MONTHLY TREND (sparkline) |
+-------------------------+----------------------------+
```

**Correspondent cards**: Name, doc count, miniature type breakdown (colored dots or mini bar). Click navigates to `/correspondents/:slug`.

**Deadline widget**: Sorted by due date. Color: red = overdue, amber = next 7 days, gray = later. Shows amount if available.

**Monthly trend**: Sparkline showing doc intake over last 12 months.

---

## Phase 3: Correspondent Detail Page (`/correspondents/:slug`)

```
+-----------------------------------------------------+
| <- Back to Dashboard                                 |
|                                                      |
| Adidas                                     20 docs   |
|                                                      |
| AI Summary:                                          |
| "Adidas is an online retailer where you purchase     |
|  shoes and sportswear. Your 20 documents span from   |
|  Jan 2024 to Mar 2026, totaling €3,240 in invoices.  |
|  Most documents are purchase receipts."              |
|                                                      |
+------------------+----------------------------------+
| Type Breakdown   |  Monthly Activity                 |
| Invoice:  15     |  [bar chart]                      |
| Receipt:   3     |                                   |
| Shipping:  2     |                                   |
+------------------+----------------------------------+
|                                                      |
| Documents from Adidas                                |
| [existing document list, pre-filtered]               |
+-----------------------------------------------------+
```

AI summary from cached `correspondents.summary`. Falls back to loading indicator on first view.

---

## Phase 4: Semantic Galaxy View (`/documents?view=galaxy`)

Full-page scatter plot visualization:

```
+-----------------------------------------------------+
|  Documents                            Color by: [v]  |
|  [Correspondent] [Type] [Tags] [Year]                |
|                                                      |
|         * *              * *                         |
|       *  *  *          *   *  *                      |
|      *  Adidas  *     * Insurance *                  |
|       *  *  *          *   *  *                      |
|         * *              * *                         |
|                                                      |
|              * *  *                                  |
|            * Tax *                                   |
|              * *                                     |
|                                                      |
+-----------------------------------------------------+
| [Hover panel]: Invoice #389 from Adidas - Mar 2026   |
+-----------------------------------------------------+
```

- Each dot = document, positioned by semantic similarity
- Color by correspondent/type/tags (dropdown toggle)
- Hover shows doc title + metadata, click opens document detail
- Lasso select for bulk operations
- Zoom & pan for large collections
- Canvas-based rendering for performance (5,000 dots is trivial)

---

## Phase 5: Timeline View (on `/documents` as view toggle)

Add a view switcher: `[List | Timeline | Galaxy]`

```
+-----------------------------------------------------+
| Documents          [List | Timeline | Galaxy]        |
+------------------+----------------------------------+
| Filters:         |  2026                             |
|                  |  +-- March (12 docs)              |
| Year    [v]      |  |   +-- Invoice from Adidas      |
| Type    [v]      |  |   +-- Receipt from Nike         |
| Corresp [v]      |  |   +-- ... +10 more             |
| Tags    [v]      |  +-- February (8 docs)             |
| Status  [v]      |  |   [collapsed]                   |
|                  |  +-- January (15 docs)              |
| Amount range     |  2025                              |
| [------|--]      |  +-- December (22 docs)             |
|                  |  ...                                |
+------------------+----------------------------------+
```

Minimap scrubber on the right edge for jumping between years. Months collapse/expand. The sidebar filters persist across all views.

---

## Phase 6: Persistent Filter Sidebar

Move filters from top dropdown bar into a collapsible left sidebar:
- Faceted checkboxes for correspondent, type, tags
- Year range slider
- Amount range slider
- Status toggles
- Active filter count badge
- "Clear all" button
- Collapse to icon-only rail on small screens
- Persists across List/Timeline/Galaxy views

---

## New Dependencies

| Package | Purpose | Size |
|---|---|---|
| `umap-js` | UMAP dimensionality reduction (backend) | ~50KB |
| `@tanstack/react-virtual` | Virtual scrolling for large lists | ~10KB |
| Canvas API (built-in) | Galaxy view rendering | 0 |
| `recharts` or `@visx` (optional) | Sparklines, bar charts in dashboard | ~150KB |

## Schema Changes

```sql
ALTER TABLE correspondents
  ADD COLUMN summary TEXT,
  ADD COLUMN summary_generated_at TIMESTAMPTZ;
```

No other schema changes needed.

## New Routes

| Route | Description |
|---|---|
| `/` | Reimagined dashboard with widgets |
| `/correspondents/:slug` | Correspondent deep-dive page |
| `/explore` | Semantic Galaxy view (standalone) |
| `/documents` | Enhanced with view switcher + sidebar filters |

## Estimated Build Effort

| Component | Effort |
|---|---|
| Dashboard Insights API | 1 day |
| Correspondent Insights API + AI summary | 1–2 days |
| UMAP Projection API | 1 day |
| Timeline API | 0.5 day |
| DB migration (correspondent summary) | 0.5 day |
| Dashboard UI (widgets) | 2 days |
| Correspondent detail page | 1 day |
| Persistent filter sidebar | 1 day |
| Galaxy view (Canvas scatter) | 2 days |
| Timeline view | 1–2 days |
| View switcher infrastructure | 0.5 day |
| **Total** | **~12–14 days** |

## Build Order

1. **Backend APIs** (Phases 1a–1e) — Dashboard insights, correspondent AI summaries, UMAP projection, timeline aggregation
2. **Dashboard UI** (Phase 2) — Widget layout with correspondent cards + deadline tasks
3. **Correspondent deep-dive page** (Phase 3) — Click through from dashboard to AI summary + filtered docs
4. **Galaxy + Timeline views** (Phases 4–5) — Visual exploration surfaces
5. **Filter sidebar** (Phase 6) — Persistent faceted filters across all views

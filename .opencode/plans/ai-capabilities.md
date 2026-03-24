# AI Capabilities Plan: LLM Search + Per-Document AI

## Overview

Enhance OpenKeep with LLM-powered search answers, unified smart search, and per-document AI features (summary + Q&A). Also apply quick wins to full-text search (GIN index, language-aware ranking).

---

## Part A: Shared LLM Service

### File: `apps/api/src/processing/llm.service.ts` (NEW)

Create a shared, injectable NestJS service that encapsulates both OpenAI and Gemini API calls with streaming support.

**Exports:**
- `LlmMessage` interface: `{ role: "system" | "user" | "assistant", content: string }`
- `LlmCompletionOptions`: `{ messages: LlmMessage[], temperature?, maxTokens?, jsonMode? }`
- `LlmStreamChunk`: `{ text: string, done: boolean }`
- `LlmService` class with:
  - `isConfigured(): boolean`
  - `getProviderInfo(): { provider: string, model: string } | null`
  - `complete(options): Promise<string | null>` — non-streaming completion
  - `stream(options): AsyncGenerator<LlmStreamChunk>` — streaming completion

**Provider resolution (same pattern as existing code):**
1. Check `OPENAI_API_KEY` → use OpenAI chat completions
2. Else check `GEMINI_API_KEY` → use Gemini generateContent
3. Else return null (not configured)

**OpenAI non-streaming:** `POST https://api.openai.com/v1/chat/completions`
- JSON mode via `response_format: { type: "json_object" }`
- Parse `choices[0].message.content`

**OpenAI streaming:** Same endpoint with `stream: true`
- Parse SSE `data:` lines, extract `choices[0].delta.content`
- Yield `[DONE]` as final chunk

**Gemini non-streaming:** `POST .../generateContent`
- Map system messages to `systemInstruction`
- Map user/assistant to `contents` with role `user`/`model`
- JSON mode via `generationConfig.responseMimeType: "application/json"`

**Gemini streaming:** `POST .../streamGenerateContent?alt=sse`
- Same body format, parse SSE data lines
- Extract `candidates[0].content.parts[].text`

### Wire into module

In `processing.module.ts`:
- Add `LlmService` to providers array
- Add `LlmService` to exports array

---

## Part B: LLM Answer Provider

### File: `apps/api/src/processing/llm-answer.provider.ts` (NEW)

Implements `AnswerProvider` interface from `provider.types.ts`.

**Constructor:** Inject `LlmService`

**`answer()` method:**
1. If `LlmService` is not configured, fall back to extractive behavior (delegate to `ExtractiveAnswerProvider` logic or return insufficient_evidence)
2. Build context from `results`:
   - For each result document, list its matched chunks with metadata (document title, page range, chunk text)
3. Construct prompt:
   ```
   System: You are a document archive assistant. Answer the user's question based ONLY on the provided document excerpts. If the excerpts don't contain enough information, say so. Always cite your sources using [Document: "title", Page: N] format. Be concise and direct. Answer in the same language as the question.
   
   User:
   ## Document Excerpts
   
   ### Document: "{title}" (ID: {id})
   
   **Chunk {index} (Pages {from}-{to}, Relevance: {score}%)**
   {chunk text}
   
   ...
   
   ## Question
   {question}
   ```
4. Call `llmService.complete()` (for non-streaming) 
5. Parse citations from the response text (look for [Document: "...", Page: N] patterns)
6. Build and return `{ status, answer, reasoning, citations }`

**For streaming:** Expose a separate method or the controller handles streaming directly.

### Update `processing.module.ts`

Change the ANSWER_PROVIDER binding:
```typescript
{
  provide: ANSWER_PROVIDER,
  useFactory: (llmService: LlmService, extractive: ExtractiveAnswerProvider) => {
    return llmService.isConfigured()
      ? new LlmAnswerProvider(llmService, extractive)
      : extractive;
  },
  inject: [LlmService, ExtractiveAnswerProvider],
}
```

This way: LLM when available, extractive as fallback.

---

## Part C: SSE Streaming Answer Endpoint

### File: `apps/api/src/search/search.controller.ts` (MODIFY)

Add new endpoint:
```typescript
@Post("answer/stream")
@Header("Content-Type", "text/event-stream")
@Header("Cache-Control", "no-cache")
@Header("Connection", "keep-alive")
async streamAnswer(@Body() body, @Res() res) {
  // 1. Run semantic search (non-streaming part)
  // 2. Send initial SSE event with search results + citations
  // 3. Stream LLM answer tokens as SSE events
  // 4. Send final SSE event with complete answer + citations
}
```

**SSE event format:**
```
event: search-results
data: {"results": [...], "citations": [...]}

event: answer-token
data: {"text": "The document..."}

event: answer-token
data: {"text": " shows that..."}

event: done
data: {"status": "answered", "fullAnswer": "...", "citations": [...]}
```

### File: `apps/api/src/documents/documents.service.ts` (MODIFY)

Add `streamAnswer()` method that:
1. Runs semantic search
2. Collects citations (reuse extractive logic for citation collection)
3. Returns an async generator that yields the LLM stream chunks

### Also add per-document streaming:

New endpoint in `documents.controller.ts`:
```typescript
@Post(":id/ask/stream")
```
Scopes the search to a single document, then streams the answer.

---

## Part D: Search Improvements (Quick Wins)

### D1. GIN Index Migration

**File: `packages/db/migrations/0007_search_improvements.sql` (NEW)**

```sql
-- GIN index for full-text search acceleration
CREATE INDEX IF NOT EXISTS idx_documents_fulltext_gin
  ON documents USING GIN(to_tsvector('simple', coalesce(full_text, '')));
```

Keep `'simple'` for the index (works as a superset — any regconfig query can use a `'simple'` GIN index for boolean matching). Language-specific ranking happens at query time.

**Update `packages/db/migrations/meta/_journal.json`** — add entry with `idx: 7`.

### D2. Language-Aware Search

**File: `apps/api/src/documents/documents.service.ts` (MODIFY)**

Add helper function:
```typescript
private languageToRegconfig(lang: string | null): string {
  switch (lang) {
    case "de": return "german";
    case "en": return "english";
    default: return "simple";
  }
}
```

**For keyword search (`listDocuments`):**
- Keep `to_tsvector('simple', ...)` in the WHERE clause (uses GIN index)
- Use language-aware regconfig for `ts_rank_cd()` and `ts_headline()`:
  ```sql
  ts_rank_cd(
    to_tsvector(
      CASE d.language WHEN 'de' THEN 'german'::regconfig WHEN 'en' THEN 'english'::regconfig ELSE 'simple'::regconfig END,
      coalesce(d.full_text, '')
    ),
    websearch_to_tsquery('simple', $query)
  ) AS rank
  ```
  Note: The tsquery still uses `'simple'` so the user's raw query terms are matched. The tsvector uses the document's language for stemming. This means searching "Rechnungen" will match a German doc containing "Rechnung" (because German stemming normalizes both).

**For `ts_headline`:** Same pattern — use the document's language regconfig for better snippet generation.

### D3. Default Relevance Sorting

**File: `apps/api/src/documents/documents.service.ts` (MODIFY)**

In `listDocuments()`, when a text query is provided:
- Default `ORDER BY` to `ts_rank_cd(...) DESC` instead of date-based sorting
- Only fall back to date sorting when no query text is present
- The `sort` query param can still override this explicitly

---

## Part E: Unified Smart Search UI

### File: `apps/web/src/routes/search.tsx` (MAJOR REWRITE)

Replace the 3-tab layout with a unified search experience:

**Layout:**
```
┌─────────────────────────────────────────────────┐
│  🔍 [Search input......................] [Search]│
│  [Filters: Correspondent ▼] [Type ▼] [Date ▼]  │
├─────────────────────────────────────────────────┤
│  ┌─ AI Answer (collapsible) ──────────────────┐ │
│  │ [Streaming answer text with citations...]  │ │
│  │ Citations: Doc A (p.3), Doc B (p.1)        │ │
│  └────────────────────────────────────────────┘ │
│                                                 │
│  Results (Hybrid Search)                        │
│  ┌──────────────────────────────────────────┐   │
│  │ Document Title           Score: 92%      │   │
│  │ Correspondent · Issue Date               │   │
│  │ "matched chunk text excerpt..."          │   │
│  │ [View Document →]                        │   │
│  └──────────────────────────────────────────┘   │
│  ┌──────────────────────────────────────────┐   │
│  │ Next result...                           │   │
│  └──────────────────────────────────────────┘   │
└─────────────────────────────────────────────────┘
```

**Behavior:**
1. On search submit, fire hybrid search (POST /api/search/semantic) with filters
2. Simultaneously start streaming answer (POST /api/search/answer/stream) 
3. Show results immediately as they come back
4. Stream the AI answer into the collapsible panel at the top
5. Answer panel auto-opens when streaming starts, can be collapsed by user
6. Filters apply to all results (keyword, semantic, and answer)

**Search params:** `?q=...&correspondent=...&type=...&dateFrom=...&dateTo=...`
Remove the `mode` param — always hybrid.

**Frontend streaming:**
```typescript
const response = await fetch("/api/search/answer/stream", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ query, filters }),
});

const reader = response.body.getReader();
const decoder = new TextDecoder();
// Parse SSE events and update state progressively
```

---

## Part F: Per-Document AI Features

### F1. Document Summary

**Backend:**

Add to `documents.controller.ts`:
```typescript
@Post(":id/summarize/stream")
```

Add to `documents.service.ts`:
```typescript
async *streamDocumentSummary(documentId: string): AsyncGenerator<LlmStreamChunk> {
  // 1. Load document with fullText
  // 2. If fullText is too long, use chunks instead (top N by position)
  // 3. Build prompt:
  //    System: "Summarize this document concisely. Include key dates, amounts, parties involved,
  //            and main purpose. Structure with bullet points. Write in the document's language."
  //    User: "[document text]"
  // 4. Stream via llmService.stream()
  // 5. After completion, store summary in metadata JSONB
}
```

**Storage:** Use `documents.metadata` JSONB field:
```json
{
  "summary": "...",
  "summaryGeneratedAt": "2026-03-23T...",
  "summaryProvider": "openai",
  "summaryModel": "gpt-4.1-mini"
}
```

### F2. Per-Document Q&A

**Backend:**

Add to `documents.controller.ts`:
```typescript
@Post(":id/ask/stream")
```

Add to `documents.service.ts`:
```typescript
async *streamDocumentAnswer(documentId: string, question: string): AsyncGenerator<...> {
  // 1. Load document chunks
  // 2. If embeddings exist, find top-N chunks by vector similarity to the question
  // 3. If no embeddings, use all chunks (or top-N by position for long docs)
  // 4. Build grounded prompt with chunks as context
  // 5. Stream LLM answer
}
```

### F3. AI Tab in Document Detail

**File: `apps/web/src/routes/documents/$documentId.tsx` (MODIFY)**

Add a 5th tab: **Preview | OCR Text | AI | Details | History**

**AI Tab contents:**
```
┌─ Summary ──────────────────────────────────────┐
│ [Generated summary text...]                    │
│                                                │
│ Generated with gpt-4.1-mini · 2 hours ago      │
│ [↻ Regenerate]                                 │
└────────────────────────────────────────────────┘

┌─ Ask a Question ───────────────────────────────┐
│ [What is the total amount due?........] [Ask]  │
│                                                │
│ [Streaming answer...]                          │
│ Sources: Page 1-2                              │
└────────────────────────────────────────────────┘
```

**Implementation:**
- Summary: `POST /api/documents/:id/summarize/stream` on tab load if no cached summary
- Cache check: Read `metadata.summary` from the document object
- Q&A: `POST /api/documents/:id/ask/stream` on form submit
- Both use SSE streaming with progressive rendering

---

## Part G: Types

### File: `packages/types/src/index.ts` (MODIFY)

Add schemas:

```typescript
export const DocumentSummarizeResponseSchema = z.object({
  summary: z.string(),
  provider: z.string(),
  model: z.string(),
  generatedAt: z.string().datetime(),
});

export const DocumentAskRequestSchema = z.object({
  question: z.string().min(1).max(1000),
});

export const DocumentAskResponseSchema = z.object({
  status: z.enum(["answered", "insufficient_evidence"]),
  answer: z.string().nullable(),
  citations: z.array(z.object({
    pageFrom: z.number().nullable(),
    pageTo: z.number().nullable(),
    quote: z.string(),
    score: z.number(),
    chunkIndex: z.number(),
  })),
});

export const SearchAnswerStreamEventSchema = z.discriminatedUnion("event", [
  z.object({ event: z.literal("search-results"), data: z.object({ results: z.array(SemanticSearchResultSchema) }) }),
  z.object({ event: z.literal("answer-token"), data: z.object({ text: z.string() }) }),
  z.object({ event: z.literal("done"), data: z.object({ status: z.enum(["answered", "insufficient_evidence"]), fullAnswer: z.string().nullable(), citations: z.array(AnswerCitationSchema) }) }),
]);
```

---

## Implementation Order

1. **LlmService** — `apps/api/src/processing/llm.service.ts` + wire into module
2. **GIN index migration** — `packages/db/migrations/0007_search_improvements.sql`
3. **Language-aware search** — modify `documents.service.ts` (ts_rank_cd + ts_headline)
4. **Relevance sorting** — modify `documents.service.ts` (default ORDER BY)
5. **LlmAnswerProvider** — `apps/api/src/processing/llm-answer.provider.ts` + swap binding
6. **SSE streaming endpoint** — modify `search.controller.ts` + `documents.service.ts`
7. **Unified smart search UI** — rewrite `search.tsx`
8. **Document summary endpoint** — modify `documents.controller.ts` + `documents.service.ts`
9. **Document Q&A endpoint** — modify `documents.controller.ts` + `documents.service.ts`
10. **AI tab on detail page** — modify `documents/$documentId.tsx`
11. **Types** — modify `packages/types/src/index.ts` (can be done alongside relevant steps)

---

## Files Changed

| File | Action | Description |
|------|--------|-------------|
| `apps/api/src/processing/llm.service.ts` | NEW | Shared LLM client (OpenAI + Gemini, streaming) |
| `apps/api/src/processing/llm-answer.provider.ts` | NEW | LLM-powered answer provider |
| `apps/api/src/processing/processing.module.ts` | MODIFY | Wire LlmService + LlmAnswerProvider |
| `apps/api/src/processing/constants.ts` | MODIFY | No changes needed (ANSWER_PROVIDER already exists) |
| `apps/api/src/documents/documents.service.ts` | MODIFY | Language-aware search, relevance sorting, summary/ask methods |
| `apps/api/src/documents/documents.controller.ts` | MODIFY | Add summarize + ask endpoints |
| `apps/api/src/search/search.controller.ts` | MODIFY | Add streaming answer endpoint |
| `packages/db/migrations/0007_search_improvements.sql` | NEW | GIN index |
| `packages/db/migrations/meta/_journal.json` | MODIFY | Add migration entry |
| `packages/types/src/index.ts` | MODIFY | Add request/response schemas |
| `apps/web/src/routes/search.tsx` | REWRITE | Unified smart search with streaming answer |
| `apps/web/src/routes/documents/$documentId.tsx` | MODIFY | Add AI tab (summary + Q&A) |

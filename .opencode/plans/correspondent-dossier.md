# Correspondent Dossier — Implementation Plan

## Status: Ready to execute

## Files to create

### `apps/mobile/src/screens/CorrespondentDossierScreen.tsx`

Full dossier screen with all 9 sections from the web version, adapted for mobile.

## Files to modify

### 1. `apps/mobile/src/lib.ts` — Add types

Insert before `formatDate` function (line 151):

```typescript
// ---------------------------------------------------------------------------
// Correspondent Dossier types
// ---------------------------------------------------------------------------

export type CorrespondentSummaryStatus = "ready" | "pending" | "unavailable";

export type CorrespondentIntelligenceProfile = {
  category: string | null;
  subcategory?: string | null;
  confidence?: number | null;
  narrative?: string | null;
  keySignals: string[];
};

export type CorrespondentIntelligenceTimelineEvent = {
  date: string | null;
  title: string;
  description: string;
  documentId?: string | null;
  documentTitle?: string | null;
};

export type CorrespondentIntelligenceChange = {
  category: string;
  title: string;
  description: string;
  effectiveDate: string | null;
  direction: "increase" | "decrease" | "update" | "notice" | "unknown";
  valueBefore?: string | null;
  valueAfter?: string | null;
  currency?: string | null;
  documentId?: string | null;
  documentTitle?: string | null;
};

export type CorrespondentIntelligenceFact = {
  label: string;
  value: string;
  asOf?: string | null;
  documentId?: string | null;
  documentTitle?: string | null;
};

export type CorrespondentInsuranceInsight = {
  policyReferences: string[];
  latestPremiumAmount?: number | null;
  latestPremiumCurrency?: string | null;
  premiumChangeSummary?: string | null;
  coverageHighlights: string[];
  renewalDate?: string | null;
  cancellationWindow?: string | null;
};

export type CorrespondentIntelligence = {
  overview: string | null;
  profile?: CorrespondentIntelligenceProfile;
  timeline: CorrespondentIntelligenceTimelineEvent[];
  changes: CorrespondentIntelligenceChange[];
  currentState: CorrespondentIntelligenceFact[];
  domainInsights: {
    insurance?: CorrespondentInsuranceInsight;
  };
  sourceDocumentIds: string[];
  provider?: string | null;
  model?: string | null;
  generatedAt?: string | null;
};

export type CorrespondentTypeCount = {
  name: string;
  count: number;
};

export type CorrespondentTimelinePoint = {
  month: string;
  count: number;
};

export type CorrespondentInsightsResponse = {
  correspondent: {
    id: string;
    name: string;
    slug: string;
    summary?: string | null;
    summaryGeneratedAt?: string | null;
    intelligenceGeneratedAt?: string | null;
  };
  summaryStatus: CorrespondentSummaryStatus;
  summary: string | null;
  intelligenceStatus: CorrespondentSummaryStatus;
  intelligence: CorrespondentIntelligence | null;
  stats: {
    documentCount: number;
    totalAmount: number | null;
    currency: string | null;
    dateRange: {
      from: string | null;
      to: string | null;
    };
    avgConfidence: number | null;
  };
  documentTypeBreakdown: CorrespondentTypeCount[];
  timeline: CorrespondentTimelinePoint[];
  recentDocuments: ArchiveDocument[];
  upcomingDeadlines: Array<{
    documentId: string;
    title: string;
    referenceNumber?: string | null;
    dueDate: string;
    amount: number | null;
    currency: string | null;
    correspondentName: string | null;
    documentTypeName?: string | null;
    taskLabel: string;
    daysUntilDue: number;
    isOverdue: boolean;
  }>;
};
```

### 2. `apps/mobile/App.tsx` — Register stack screen

Add to `AppStackParamList` (line 24-29):

```typescript
export type AppStackParamList = {
  Home: undefined;
  DocumentDetail: { documentId: string; title?: string };
  Review: undefined;
  Scan: undefined;
  CorrespondentDossier: { slug: string; name: string };
};
```

Add import at top:

```typescript
import { CorrespondentDossierScreen } from "./src/screens/CorrespondentDossierScreen";
```

Add stack screen after Scan (line 155):

```typescript
<Stack.Screen
  name="CorrespondentDossier"
  component={CorrespondentDossierScreen}
  options={({ route }) => ({
    title: route.params.name,
  })}
/>
```

### 3. `apps/mobile/src/screens/DashboardScreen.tsx` — Make cluster cards tappable

In `ClusterStrip`, accept `onPress` callback and change `View` to `Pressable` for each card:

```typescript
function ClusterStrip({
  data,
  onPress,
}: {
  data: Correspondent[];
  onPress: (item: Correspondent) => void;
}) {
```

Change the card render (line 177) from `<View key={item.id} style={clusterStyles.card}>` to:

```typescript
<Pressable
  key={item.id}
  onPress={() => onPress(item)}
  style={({ pressed }) => [clusterStyles.card, pressed ? clusterStyles.cardPressed : null]}
>
```

Close with `</Pressable>` instead of `</View>`.

Add `cardPressed` style:

```typescript
cardPressed: {
  opacity: 0.92,
  transform: [{ scale: 0.97 }],
},
```

Update usage in DashboardScreen (line 671):

```typescript
<ClusterStrip
  data={data.topCorrespondents}
  onPress={(item) =>
    navigation.navigate("CorrespondentDossier", {
      slug: item.slug,
      name: item.name,
    })
  }
/>
```

### 4. `apps/mobile/src/screens/CorrespondentDossierScreen.tsx` — New file

Complete screen implementation with all 9 sections:

1. **MetricRibbon** — Documents count, smart highlight, last doc date, detected changes
2. **Relationship Overview** — overview text + profile chips (category, subcategory, key signals)
3. **Key Changes** — list of detected changes with title, date, description, before→after
4. **Monthly Activity** — horizontal scrollable mini bar chart (reuse IntakeTrend pattern)
5. **Current State** — label/value fact cards with asOf dates
6. **Timeline Highlights** — event cards sorted newest first
7. **Insurance Lens** (conditional) — policy refs, premium, renewal, cancellation, coverage chips
8. **Type Breakdown + Legacy Summary** — type list + summary text
9. **Documents** — document cards list from secondary query

Key implementation details:
- Two queries: insights (with 4s polling while pending) + documents (enabled when correspondent ID available)
- `buildSmartHighlight()` helper (insurance premium > latest amount > latest doc type > top type)
- `findCurrentStateFact()` helper
- `compareDocumentsNewestFirst()` / `compareIsoDates()` helpers
- Loading state, error state with retry, loaded content
- `includeTopSafeArea={false}` (stack screen with native header)
- Uses Screen component with `headerVariant="compact"`, eyebrow "Correspondent Dossier"
- All sections use the earthy theme: Card, surfaceRaised backgrounds, rounded corners, shadow

## Verification

After all changes: `pnpm --filter @openkeep/mobile typecheck`

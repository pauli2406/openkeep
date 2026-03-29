# Silent Offline UX Overhaul

## Goal
Remove all explicit offline mode UX — badges, pills, banners, interstitials, toggles, and full-screen replacements — making offline a transparent, silent fallback. The app should just work from cached data without telling the user it's offline.

## Pre-conditions
- Auth timeouts, cached user persistence, offline snapshot gating, and auto-reconnect revalidation are already implemented (uncommitted in working tree).
- `pnpm typecheck` passes.
- All line numbers verified accurate as of 2026-03-29.

---

## Phase 1: Full-screen offline replacements -> graceful degradation

### 1. SearchScreen.tsx (lines 78-104)
**Remove** the entire `if (offline.shouldUseOffline) { return (...) }` block (lines 78-104).
- The normal search UI will render. Suggestions are already disabled when offline (line 41: `!offline.shouldUseOffline`).
- If a search is attempted and the network request fails, the existing `ErrorCard` at lines 159-164 handles it.
- **Also remove** unused styles: `offlineTitle` (lines 637-641) and `offlineBody` (lines 642-645).

### 2. ScanScreen.tsx (lines 70-78)
**Remove** the entire `if (offline.shouldUseOffline) { return (...) }` block (lines 70-78).
- The normal scan UI renders. If upload fails, the existing `ErrorCard` at line 242 handles it.
- The upload mutation's error handling already shows a proper error message.
- **Also remove** unused style: `offlineText` (lines 255-258).

### 3. CorrespondentDossierScreen.tsx (lines 950-965)
**Remove** the entire `if (offline.shouldUseOffline) { return (...) }` block (lines 950-965).
- The dossier will attempt to load data. If the network request fails, the existing query error states (loading/error) will display naturally.
- The user can still see the correspondent name in the header.

### 4. ReviewScreen.tsx (lines 110-112)
**Remove** the offline notice card:
```tsx
// DELETE these 3 lines:
{offline.shouldUseOffline ? (
  <Card><Text style={styles.helper}>{t("review.offlineDisabled")}</Text></Card>
) : null}
```
- Action buttons are already silently disabled via `disabled={offline.shouldUseOffline}` (lines 89, 98). This is sufficient — buttons appear but can't be pressed when offline. No banner needed.

---

## Phase 2: Remove explicit offline badges/pills/banners

### 5. DocumentsScreen.tsx

**a) Remove offline browsing banner (line 116):**
```tsx
// DELETE:
{offline.shouldUseOffline ? <Text style={styles.helper}>{t("documents.offlineBrowsing")}</Text> : null}
```

**b) Remove selection/pin mode controls (lines 117-134):**
```tsx
// DELETE the entire <View style={styles.selectionActions}> block and the selectionHint text below it (lines 117-134)
```
Also remove related state and handler:
- `const [selectionMode, setSelectionMode] = useState(false);` 
- `const [selectedIds, setSelectedIds] = useState<string[]>([]);`
- `handlePinSelected` function
- Selection checkbox in the document card rendering (look for `selectionMode` conditional)

**c) Remove per-document pills (lines 170-177):**
```tsx
// DELETE:
{indicatorsQuery.data?.get(document.id)?.hasLocalFile ? (
  <Pill label={t("documents.localFile")} tone="success" />
) : indicatorsQuery.data?.get(document.id) ? (
  <Pill label={t("documents.metadataOnly")} tone="warning" />
) : null}
{indicatorsQuery.data?.get(document.id)?.isPinnedOffline ? (
  <Pill label={t("documents.pinnedOffline")} tone="default" />
) : null}
```

**d) Consider removing** the `indicatorsQuery` entirely if it's only used for these pills.

### 6. DocumentDetailScreen.tsx

**a) Remove availability pill (line 219):**
```tsx
// DELETE:
<Pill label={formatAvailabilityStatus(t, availabilityQuery.data ?? "syncing")} tone={toneForAvailability(availabilityQuery.data ?? "syncing")} />
```
Also remove the `availabilityQuery`, `formatAvailabilityStatus`, and `toneForAvailability` if they become unused.

**b) Remove "Keep offline" toggle (lines 382-386):**
```tsx
// DELETE:
<Button
  label={isPinnedOffline ? t("documentDetail.preview.keepOfflineOn") : t("documentDetail.preview.keepOfflineOff")}
  variant={isPinnedOffline ? "primary" : "secondary"}
  onPress={() => void offline.setDocumentPinnedOffline(authFetch, document, !isPinnedOffline)}
/>
```
Also remove the `isPinnedOffline` state/query if it becomes unused.

**c) Remove offlineReadOnly banner (lines 678-680):**
```tsx
// DELETE:
{offlineReadOnly ? (
  <Text style={styles.hintText}>{t("documentDetail.overview.offlineReadOnly")}</Text>
) : null}
```
Instead, silently disable write actions: where `offlineReadOnly` is used to conditionally disable buttons, keep the `disabled` prop but remove any text/banner that says "offline read-only". If edit buttons are currently shown but disabled with a message, consider hiding them entirely when `offlineReadOnly` is true.

---

## Phase 3: DocumentViewer transparent fetch

### 7. DocumentViewer.tsx

**Remove the offline guard in `downloadFile()` (lines 115-117):**
```tsx
// DELETE:
if (offlineMode && !hasLocalFile) {
  setFileState({ status: "error", message: t("documentViewer.offlineFileMissing") });
  return;
}
```
- Instead, always attempt the download. The existing fetch logic will try the network request. If it fails (offline + no local file), it will naturally fall into the error state via the try/catch in the rest of `downloadFile()`.
- The error will display via the generic error rendering, which is fine — it just won't specifically say "file not stored locally" as a separate blocking interstitial.

**Also check** lines 298-316: The "online fetch" fallback interstitial. This may be fine to keep since it handles the case where an online fetch failed and offers retry. But verify it doesn't mention "offline" explicitly. If it does, adjust the message to be generic (e.g., "Could not load file. Tap to retry.").

---

## Phase 4: Dashboard silent degradation

### 8. DashboardScreen.tsx (lines 747-751)

**Remove** the offline notice card:
```tsx
// DELETE:
{offline.shouldUseOffline ? (
  <Card>
    <Text style={styles.offlineText}>{t("dashboard.screen.offlineTaskDisabled")}</Text>
  </Card>
) : null}
```
- Task completion is already silently disabled: line 744 passes `undefined` for `onComplete` when offline. Tasks show but can't be completed — no need to announce it.

---

## Phase 5: Settings cleanup

### 9. SettingsScreen.tsx

**Remove the following rows from the offline archive settings card:**
- Offline mode toggle (lines 368-373)
- Reachability display (lines 375-380)
- Sync buttons (lines 385-397)
- Retention settings (lines 398-418)
- Cache stats / storage info (lines 419-449)

**Keep:** The card header itself (so the offline archive card section is not completely orphaned). OR, if removing all rows empties the card, remove the entire card.

**Alternative approach:** Instead of removing the card entirely, keep a single non-interactive "Last synced: ..." display row. This gives a subtle signal without being an explicit offline mode toggle. Decide based on what other settings remain in the card.

---

## Phase 6: i18n cleanup

### 10. i18n.tsx

After all UX changes, identify and remove dead i18n string keys. Expected removals (~40+ keys):

**Search:**
- `search.offlineSubtitle`, `search.offlineTitle`, `search.offlineBody`

**Scan:**
- `scan.offlineSubtitle`, `scan.offlineBody`

**Documents:**
- `documents.offlineBrowsing`, `documents.localFile`, `documents.metadataOnly`, `documents.pinnedOffline`
- `documents.cancelSelection`, `documents.select`, `documents.pinSelected`, `documents.selectionHint`

**DocumentDetail:**
- `documentDetail.preview.keepOfflineOn`, `documentDetail.preview.keepOfflineOff`
- `documentDetail.overview.offlineReadOnly`

**DocumentViewer:**
- `documentViewer.offlineFileMissing`

**Correspondent:**
- `correspondent.screen.offlineOnly`

**Review:**
- `review.offlineDisabled`

**Dashboard:**
- `dashboard.screen.offlineTaskDisabled`

**Settings:**
- `settings.offlineArchiveMode`, `settings.enabled`, `settings.readyWhenNeeded`, `settings.usingLocalArchive`
- `settings.archiveStatus`
- `settings.syncLocalArchive`, `settings.syncLocalArchiveHint`
- `settings.forceFullResync`, `settings.forceFullResyncHint`
- `settings.retention.mode`, `settings.retention.fileAge`, `settings.retention.storageCap`
- `settings.cachedDocuments`, `settings.localStorage`
- `settings.retention.localFiles`, `settings.retention.localFileCount`
- `settings.lastSync`

**Note:** Do a grep for each key before removing to make sure it's truly unused.

---

## Phase 7: Verify

1. Run `pnpm typecheck` — must pass clean
2. Grep for removed i18n keys to confirm no references remain
3. Grep for `offlineTitle`, `offlineBrowsing`, `offlineDisabled`, `offlineOnly`, `keepOffline`, `pinnedOffline`, `metadataOnly` to catch any stragglers
4. Grep for `offlineText` style references to ensure no dangling style definitions

---

## Execution Order

Phases 1-4 are independent and can be done in parallel by file. Phase 5 (Settings) is independent. Phase 6 (i18n) depends on all others completing first. Phase 7 is final verification.

Recommended batch:
1. Edit all 8 screen/component files (Phases 1-5) in parallel
2. Then do i18n cleanup (Phase 6)
3. Then verify (Phase 7)

import {
  createArchiveRequestHeaders,
  resolveArchiveApiUrl,
  type DesktopFetch,
} from "./connection";
import type { ArchiveSessionService } from "./archive-session";
import type { ImportDocumentState } from "./import-outcomes";

type DocumentStatusResponse = {
  status?: unknown;
  reviewStatus?: unknown;
  embeddingStatus?: unknown;
};

/**
 * Classifies one document's processing state for the outcome tracker.
 *
 * The vocabulary is the archive's: `status` covers pending/processing/ready/
 * failed, `embeddingStatus` can still be queued or indexing after a document is
 * otherwise ready, and `reviewStatus` decides whether a ready document needs the
 * user. Only the file name reaches a notification — never the archive's error
 * text, which can quote document content.
 */
export function classifyDocumentState(
  body: DocumentStatusResponse,
): ImportDocumentState {
  if (body.status === "failed") return { state: "settled", kind: "failed" };
  if (body.status !== "ready") return { state: "processing" };
  if (body.embeddingStatus === "queued" || body.embeddingStatus === "indexing") {
    return { state: "processing" };
  }
  if (body.embeddingStatus === "failed") return { state: "settled", kind: "failed" };
  return body.reviewStatus === "pending"
    ? { state: "settled", kind: "review" }
    : { state: "settled", kind: "completed" };
}

export function createArchiveDocumentStatusReader({
  archiveSession,
  fetchRequest,
}: {
  archiveSession: Pick<ArchiveSessionService, "getActiveSession">;
  fetchRequest: DesktopFetch;
}) {
  return {
    async inspect(profileId: string, documentId: string): Promise<ImportDocumentState> {
      const active = archiveSession.getActiveSession();
      if (!active || active.profile.id !== profileId) {
        return { state: "unavailable" };
      }

      let response: Response;
      try {
        response = await fetchRequest(
          resolveArchiveApiUrl(
            active.profile.serverUrl,
            `/api/documents/${encodeURIComponent(documentId)}`,
          ),
          {
            method: "GET",
            headers: createArchiveRequestHeaders(active.credentials),
            signal: active.signal,
          },
        );
      } catch {
        return { state: "unavailable" };
      }

      if (response.status === 404 || response.status === 410) {
        await response.body?.cancel().catch(() => undefined);
        return { state: "missing" };
      }
      if (!response.ok) {
        await response.body?.cancel().catch(() => undefined);
        return { state: "unavailable" };
      }

      try {
        return classifyDocumentState((await response.json()) as DocumentStatusResponse);
      } catch {
        return { state: "unavailable" };
      }
    },
  };
}

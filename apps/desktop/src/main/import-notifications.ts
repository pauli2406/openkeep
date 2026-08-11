import { APP_URL, isTrustedRendererUrl } from "./security";
import type { ImportOutcomeBatch } from "./import-outcomes";
import type { DesktopNotificationPreferences } from "../shared/desktop-api";

export type DesktopNotificationRequest = {
  title: string;
  body: string;
  onClick: () => void;
};

export type DesktopNotifier = {
  isSupported(): boolean;
  show(request: DesktopNotificationRequest): void;
};

/** Where a clicked notification should land. */
export type NotificationTarget = {
  profileId: string;
  url: string;
};

export function documentRouteUrl(documentId: string): string | null {
  const url = `${APP_URL}documents/${encodeURIComponent(documentId)}`;
  return isTrustedRendererUrl(url) ? url : null;
}

export function reviewRouteUrl(): string {
  return `${APP_URL}review`;
}

function describe(batch: ImportOutcomeBatch): { title: string; body: string } {
  const count = batch.documents.length;
  const first = batch.documents[0]?.name || "A document";
  if (batch.kind === "completed") {
    return count === 1
      ? { title: "Document imported", body: `${first} is ready.` }
      : { title: "Documents imported", body: `${count} documents are ready.` };
  }
  if (batch.kind === "review") {
    return count === 1
      ? { title: "Document needs review", body: `${first} is waiting for you.` }
      : {
          title: "Documents need review",
          body: `${count} documents are waiting for you.`,
        };
  }
  return count === 1
    ? { title: "Import failed", body: `${first} could not be processed.` }
    : { title: "Imports failed", body: `${count} documents could not be processed.` };
}

/**
 * Turns settled import outcomes into at most one native notification per batch.
 *
 * A notification carries a file name and a count, never OCR text, an archive
 * address, a token, or a Cloudflare secret. One document opens that document; a
 * batch opens the review queue or the document list, because deep-linking one
 * arbitrary member of a batch is a guess.
 */
export function createDesktopImportNotifier({
  notifier,
  preferences,
  open,
}: {
  notifier: DesktopNotifier;
  preferences: () => DesktopNotificationPreferences;
  open: (target: NotificationTarget) => void;
}) {
  function targetFor(batch: ImportOutcomeBatch): NotificationTarget {
    const single = batch.documents.length === 1 ? batch.documents[0] : undefined;
    if (batch.kind === "review") {
      const url = single ? documentRouteUrl(single.documentId) : null;
      return { profileId: batch.profileId, url: url ?? reviewRouteUrl() };
    }
    const url = single ? documentRouteUrl(single.documentId) : null;
    return { profileId: batch.profileId, url: url ?? `${APP_URL}documents` };
  }

  return {
    supported() {
      return notifier.isSupported();
    },

    present(batch: ImportOutcomeBatch) {
      if (batch.documents.length === 0) return;
      if (!preferences()[batch.kind]) return;
      if (!notifier.isSupported()) return;
      const { title, body } = describe(batch);
      const target = targetFor(batch);
      notifier.show({ title, body, onClick: () => open(target) });
    },
  };
}

export type DesktopImportNotifier = ReturnType<typeof createDesktopImportNotifier>;

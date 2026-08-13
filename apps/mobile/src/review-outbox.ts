/**
 * A confirm that has been tapped but not yet sent.
 *
 * Confirming a review is held for the undo window and posted when the window
 * closes, so undo cannot race an in-flight resolve. The gap that leaves: kill the
 * app inside those five seconds and the confirm is never sent. The document stays
 * pending review, which is the safe direction, but the user watched it be
 * accepted — and the next launch shows it back in the queue with no explanation.
 *
 * So the pending confirm is written down before the window opens and replayed on
 * the next launch. It is scoped to the account and archive that made it, for the
 * same reason the offline copy is: replaying one account's confirm against
 * another's archive would be worse than losing it.
 */

export type PendingConfirm = {
  documentId: string;
  /** Which archive and account tapped Confirm. */
  scope: string;
  heldAt: string;
};

export type OutboxStorage = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
};

const STORAGE_KEY = "openkeep.mobile.review-outbox";

/**
 * How long a held confirm stays replayable. A confirm the user tapped weeks ago,
 * against a document whose state they can no longer remember, is not worth
 * sending unasked; the document is still in the queue, which is the honest
 * outcome.
 */
export const PENDING_CONFIRM_TTL_MS = 24 * 60 * 60 * 1000;

function isPendingConfirm(value: unknown): value is PendingConfirm {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as Partial<PendingConfirm>;
  return (
    typeof candidate.documentId === "string" &&
    typeof candidate.scope === "string" &&
    typeof candidate.heldAt === "string"
  );
}

export function createReviewOutbox({
  storage,
  now = () => new Date(),
}: {
  storage: OutboxStorage;
  now?: () => Date;
}) {
  /** Records a confirm before its undo window opens. */
  async function hold(entry: { documentId: string; scope: string }) {
    await storage.setItem(
      STORAGE_KEY,
      JSON.stringify({ ...entry, heldAt: now().toISOString() } satisfies PendingConfirm),
    );
  }

  /** Forgets the held confirm, because it was sent or taken back. */
  async function release() {
    await storage.removeItem(STORAGE_KEY);
  }

  async function read(): Promise<PendingConfirm | null> {
    let raw: string | null = null;
    try {
      raw = await storage.getItem(STORAGE_KEY);
    } catch {
      return null;
    }
    if (!raw) {
      return null;
    }
    try {
      const parsed = JSON.parse(raw) as unknown;
      return isPendingConfirm(parsed) ? parsed : null;
    } catch {
      // Unreadable is the same as absent, and the row goes on the next hold.
      return null;
    }
  }

  /**
   * Sends a confirm the app was killed on top of. `send` is the same mutation the
   * screen uses, so the server sees no difference between this and a window that
   * closed normally.
   *
   * A confirm from another scope, or one older than the TTL, is dropped rather
   * than sent: the document is still in the review queue either way.
   */
  async function flush({
    scope,
    send,
  }: {
    scope: string;
    send: (documentId: string) => Promise<void>;
  }): Promise<"sent" | "expired" | "foreign" | "empty" | "failed"> {
    const pending = await read();
    if (!pending) {
      return "empty";
    }
    if (pending.scope !== scope) {
      return "foreign";
    }
    const heldAt = Date.parse(pending.heldAt);
    if (!Number.isFinite(heldAt) || now().getTime() - heldAt > PENDING_CONFIRM_TTL_MS) {
      await release();
      return "expired";
    }

    try {
      await send(pending.documentId);
    } catch {
      // Kept for the next launch: a failed send is a network problem, not a
      // reason to lose the confirm a second time.
      return "failed";
    }
    await release();
    return "sent";
  }

  return { hold, release, read, flush };
}

export type ReviewOutbox = ReturnType<typeof createReviewOutbox>;

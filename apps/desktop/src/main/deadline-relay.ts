import { createArchiveRequestHeaders, resolveArchiveApiUrl, type DesktopFetch } from "./connection";
import { documentRouteUrl, type DesktopNotifier, type NotificationTarget } from "./import-notifications";

/** The wire shape of GET /api/notifications items this relay consumes. */
type DeadlineNotification = {
  id: string;
  documentId: string;
  documentTitle: string;
  correspondentName: string | null;
  window: "upcoming" | "due" | "overdue";
  dueDate: string;
};

type ActiveArchive = {
  profile: { id: string; serverUrl: string };
  credentials: { apiToken: string; cfAccessClientId?: string; cfAccessClientSecret?: string };
};

const DEFAULT_POLL_INTERVAL_MS = 5 * 60_000;

function describe(item: DeadlineNotification): { title: string; body: string } {
  const title =
    item.window === "overdue"
      ? "Deadline overdue"
      : item.window === "due"
        ? "Due today"
        : "Deadline approaching";
  const who = item.correspondentName ? ` (${item.correspondentName})` : "";
  return { title, body: `${item.documentTitle}${who} — due ${item.dueDate}` };
}

/**
 * Relays server-side deadline notifications as OS notifications for the
 * active archive. The server's per-channel delivered mark is the
 * announce-once mechanism: the relay claims a record first and announces
 * only when the claim succeeded, so restarts and second installations
 * cannot re-announce, and of several pollers the first one wins.
 *
 * A reminder is not a chat: a modest interval is enough, and a tick with no
 * active or connected profile does nothing, without error noise.
 */
export function createDesktopDeadlineRelay({
  fetchRequest,
  activeArchive,
  notifier,
  enabled,
  open,
  intervalMs = DEFAULT_POLL_INTERVAL_MS,
  reportError,
}: {
  fetchRequest: DesktopFetch;
  activeArchive: () => ActiveArchive | null;
  notifier: DesktopNotifier;
  enabled: () => boolean;
  open: (target: NotificationTarget) => void;
  intervalMs?: number;
  reportError?: (message: string, error: unknown) => void;
}) {
  let timer: NodeJS.Timeout | null = null;
  let polling = false;

  async function poll(): Promise<void> {
    if (polling) return;
    if (!enabled() || !notifier.isSupported()) return;
    const active = activeArchive();
    if (!active) return;

    polling = true;
    try {
      const headers = createArchiveRequestHeaders(active.credentials);
      const response = await fetchRequest(
        resolveArchiveApiUrl(active.profile.serverUrl, "/api/notifications?undeliveredFor=desktop"),
        { method: "GET", headers, redirect: "manual" },
      );
      if (!response.ok) return;
      const payload = (await response.json()) as { items?: DeadlineNotification[] };
      const items = Array.isArray(payload.items) ? payload.items : [];

      for (const item of items) {
        // Claim before announcing: a failed claim means someone else already
        // delivered this record, and announcing it again would be the bug.
        const claim = await fetchRequest(
          resolveArchiveApiUrl(
            active.profile.serverUrl,
            `/api/notifications/${encodeURIComponent(item.id)}/delivered`,
          ),
          {
            method: "POST",
            headers: (() => {
              const claimHeaders = createArchiveRequestHeaders(active.credentials);
              claimHeaders.set("content-type", "application/json");
              return claimHeaders;
            })(),
            body: JSON.stringify({ channel: "desktop" }),
            redirect: "manual",
          },
        );
        if (!claim.ok) continue;
        const outcome = (await claim.json()) as { delivered?: boolean };
        if (!outcome.delivered) continue;

        const { title, body } = describe(item);
        const url = documentRouteUrl(item.documentId);
        if (!url) continue;
        notifier.show({
          title,
          body,
          onClick: () => open({ profileId: active.profile.id, url }),
        });
      }
    } catch (error) {
      reportError?.("OpenKeep could not check deadline reminders.", error);
    } finally {
      polling = false;
    }
  }

  return {
    start() {
      if (timer) return;
      void poll();
      timer = setInterval(() => void poll(), intervalMs);
      timer.unref?.();
    },

    stop() {
      if (timer) clearInterval(timer);
      timer = null;
    },

    /** Exposed for tests and for an immediate check after a profile connects. */
    poll,
  };
}

export type DesktopDeadlineRelay = ReturnType<typeof createDesktopDeadlineRelay>;

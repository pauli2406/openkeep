import type { DesktopSessionState } from "../../shared/desktop-api";

export const OFFLINE_RECONNECT_INTERVAL_MS = 30_000;

export type ReconnectTimer = {
  start(run: () => void, intervalMs: number): void;
  stop(): void;
};

/**
 * The way out of an offline session.
 *
 * Mobile's offline mode is a dead end: its revalidation function is dead code
 * and nothing ever returns the app to live data short of a relaunch. Desktop
 * polls instead: while an offline session is open, the owning profile is
 * re-verified on an interval, and the first successful verification returns
 * the user to live data automatically — no click, no restart, and no offline
 * mutations to replay because offline is read-only by construction.
 *
 * The verification is the ordinary profile activation, so its outcomes keep
 * their existing meanings: `connected` ends the offline session, a rejected
 * credential follows the same invalid-credentials path as everywhere else
 * (the profile is removed, and the session with it), and anything transient —
 * unreachable, unhealthy — stays offline quietly and tries again later.
 */
export function createOfflineReconnect({
  timer,
  offlineProfileId,
  activateProfile,
  onReconnected,
  onCredentialsRejected,
  reportError,
  intervalMs = OFFLINE_RECONNECT_INTERVAL_MS,
}: {
  timer: ReconnectTimer;
  /** The profile currently open offline, or null when none is. */
  offlineProfileId: () => string | null;
  activateProfile: (profileId: string) => Promise<DesktopSessionState>;
  onReconnected: (profileId: string, state: DesktopSessionState) => void;
  onCredentialsRejected: (profileId: string, state: DesktopSessionState) => void;
  reportError?: (message: string, error: unknown) => void;
  intervalMs?: number;
}) {
  let checking = false;

  async function check() {
    const profileId = offlineProfileId();
    if (!profileId || checking) return;
    checking = true;
    try {
      const state = await activateProfile(profileId);
      // The offline session may have ended or switched while we verified;
      // a stale result must not yank a different session around.
      if (offlineProfileId() !== profileId) return;
      if (state.status === "connected") {
        onReconnected(profileId, state);
      } else if (
        state.status === "disconnected" &&
        state.reason === "invalid-credentials"
      ) {
        onCredentialsRejected(profileId, state);
      }
      // Anything else — unreachable, unhealthy, superseded — stays offline.
    } catch (error) {
      reportError?.("The offline reconnect check failed.", error);
    } finally {
      checking = false;
    }
  }

  return {
    start() {
      timer.start(() => void check(), intervalMs);
    },
    /** One immediate check, for tests and for an explicit user retry. */
    check,
    stop() {
      timer.stop();
    },
  };
}

export type OfflineReconnect = ReturnType<typeof createOfflineReconnect>;

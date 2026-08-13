/**
 * Returning to live data from an offline session.
 *
 * `revalidateSession` existed, was exported, and was called from nowhere: for a
 * session opened with "Open the offline copy" nothing ever cleared the offline
 * mode, so relaunching the app was the only way back. This is the loop that was
 * missing, kept out of the provider so its rules can be tested without React.
 *
 * Each outcome keeps the meaning the session-restore path already gives it:
 * reachable ends the offline session on live data, rejected credentials take the
 * app back to the connect screen rather than leaving a session nobody can use,
 * and anything else stays offline quietly and tries again.
 */

export type SessionProbe = "online" | "rejected" | "unreachable";

export const OFFLINE_RECONNECT_INTERVAL_MS = 30_000;

export type OfflineReconnect = {
  /** Runs a check now, for an explicit retry. */
  check(): Promise<SessionProbe | "skipped">;
  start(): void;
  stop(): void;
};

export function createOfflineReconnect({
  probe,
  isOffline,
  onOnline,
  onRejected,
  timer,
  intervalMs = OFFLINE_RECONNECT_INTERVAL_MS,
}: {
  probe: () => Promise<SessionProbe>;
  /** Whether an offline session is open right now. */
  isOffline: () => boolean;
  onOnline: () => void;
  onRejected: () => void;
  timer: {
    start(run: () => void, intervalMs: number): void;
    stop(): void;
  };
  intervalMs?: number;
}): OfflineReconnect {
  let checking = false;

  async function check(): Promise<SessionProbe | "skipped"> {
    // One check at a time: a slow probe plus a connectivity flip would otherwise
    // run several at once and act on whichever finished last.
    if (checking || !isOffline()) {
      return "skipped";
    }
    checking = true;
    try {
      const outcome = await probe();
      // The session can end while the probe is in flight — the user signs out,
      // or another check got there first. A late result must not drag a session
      // that has since moved on back into a state it left.
      if (!isOffline()) {
        return "skipped";
      }
      if (outcome === "online") {
        onOnline();
      } else if (outcome === "rejected") {
        onRejected();
      }
      return outcome;
    } catch {
      // An unexpected throw is indistinguishable from an unreachable archive:
      // stay offline and try again rather than tear down a working copy.
      return "unreachable";
    } finally {
      checking = false;
    }
  }

  return {
    check,
    start() {
      timer.start(() => void check(), intervalMs);
    },
    stop() {
      timer.stop();
    },
  };
}

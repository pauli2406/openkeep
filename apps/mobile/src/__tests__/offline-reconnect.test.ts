/**
 * Returning to live data without a relaunch.
 *
 * `revalidateSession` was defined, exported on the context, and called from
 * nowhere — the only other reference in the repo was a visual-test stub. So a
 * session opened with "Open the offline copy" had no way out: no poll, no retry,
 * every refetch interval disabled. Relaunching the app was the only escape.
 *
 * These tests are about the rules, not the wiring: each probe outcome keeps the
 * meaning the session-restore path already gives it.
 */
import {
  OFFLINE_RECONNECT_INTERVAL_MS,
  createOfflineReconnect,
  type SessionProbe,
} from "../offline-reconnect";

function createHarness(options: {
  probe: () => Promise<SessionProbe>;
  offline?: boolean;
}) {
  let offline = options.offline ?? true;
  const events: string[] = [];
  let ticker: (() => void) | null = null;
  let intervalMs = 0;

  const reconnect = createOfflineReconnect({
    probe: options.probe,
    isOffline: () => offline,
    onOnline: () => {
      offline = false;
      events.push("online");
    },
    onRejected: () => {
      offline = false;
      events.push("rejected");
    },
    timer: {
      start: (run, ms) => {
        ticker = run;
        intervalMs = ms;
      },
      stop: () => {
        ticker = null;
      },
    },
  });

  return {
    reconnect,
    events,
    tick: () => ticker?.(),
    isRunning: () => ticker !== null,
    intervalMs: () => intervalMs,
    endSession: () => {
      offline = false;
    },
  };
}

describe("while an offline session is open", () => {
  it("ends the session when the archive answers", async () => {
    const harness = createHarness({ probe: async () => "online" });

    expect(await harness.reconnect.check()).toBe("online");

    expect(harness.events).toEqual(["online"]);
  });

  it("takes the app off the offline session when the credentials are refused", async () => {
    const harness = createHarness({ probe: async () => "rejected" });

    expect(await harness.reconnect.check()).toBe("rejected");

    // Not a usable offline session left behind: the connect screen takes over.
    expect(harness.events).toEqual(["rejected"]);
  });

  it("stays offline quietly when the archive cannot be reached", async () => {
    const harness = createHarness({ probe: async () => "unreachable" });

    expect(await harness.reconnect.check()).toBe("unreachable");

    expect(harness.events).toEqual([]);
  });

  it("stays offline when the probe throws", async () => {
    const harness = createHarness({
      probe: async () => {
        throw new Error("network");
      },
    });

    expect(await harness.reconnect.check()).toBe("unreachable");
    expect(harness.events).toEqual([]);
  });

  it("keeps trying on an interval, and stops when told", async () => {
    const probe = jest.fn(async (): Promise<SessionProbe> => "unreachable");
    const harness = createHarness({ probe });
    // Each tick has to settle before the next: two overlapping ticks collapse
    // into one by design, which the re-entrancy test below covers.
    const settle = () => new Promise((resolve) => setImmediate(resolve));

    harness.reconnect.start();
    expect(harness.intervalMs()).toBe(OFFLINE_RECONNECT_INTERVAL_MS);
    harness.tick();
    await settle();
    harness.tick();
    await settle();
    expect(probe).toHaveBeenCalledTimes(2);

    harness.reconnect.stop();
    expect(harness.isRunning()).toBe(false);
  });
});

describe("guards", () => {
  it("runs one check at a time", async () => {
    let release: (outcome: SessionProbe) => void = () => undefined;
    const probe = jest.fn(
      () =>
        new Promise<SessionProbe>((resolve) => {
          release = resolve;
        }),
    );
    const harness = createHarness({ probe });

    const first = harness.reconnect.check();
    // A connectivity flip arriving mid-probe must not start a second one.
    expect(await harness.reconnect.check()).toBe("skipped");
    release("unreachable");
    await first;

    expect(probe).toHaveBeenCalledTimes(1);
  });

  it("discards a result that arrives after the session has moved on", async () => {
    let release: (outcome: SessionProbe) => void = () => undefined;
    const harness = createHarness({
      probe: () =>
        new Promise<SessionProbe>((resolve) => {
          release = resolve;
        }),
    });

    const pending = harness.reconnect.check();
    // The user signs out, or another check got there first, while this one is
    // still in flight. A late "online" must not drag the session back.
    harness.endSession();
    release("online");

    expect(await pending).toBe("skipped");
    expect(harness.events).toEqual([]);
  });

  it("does not check at all when no offline session is open", async () => {
    const probe = jest.fn(async (): Promise<SessionProbe> => "online");
    const harness = createHarness({ probe, offline: false });

    expect(await harness.reconnect.check()).toBe("skipped");
    expect(probe).not.toHaveBeenCalled();
  });
});

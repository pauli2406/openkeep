import { describe, expect, it, vi } from "vitest";
import { installDesktopLaunchLifecycle } from "./launch-lifecycle";

type Handler = (...arguments_: unknown[]) => void;

function fakeApp(ownsLock = true) {
  const handlers = new Map<string, Handler>();
  return {
    handlers,
    app: {
      requestSingleInstanceLock: vi.fn(() => ownsLock),
      quit: vi.fn(),
      on: vi.fn((event: string, handler: Handler) => {
        handlers.set(event, handler);
      }),
    },
  };
}

describe("desktop launch lifecycle", () => {
  it("exits a secondary process without installing lifecycle listeners", () => {
    const fake = fakeApp(false);
    expect(
      installDesktopLaunchLifecycle({
        app: fake.app,
        defaultApp: false,
        focusWindow: vi.fn(),
      }),
    ).toBeNull();
    expect(fake.app.quit).toHaveBeenCalledOnce();
    expect(fake.app.on).not.toHaveBeenCalled();
  });

  it("queues cold and macOS files, then forwards warm invocations in order", async () => {
    const fake = fakeApp();
    const focusWindow = vi.fn();
    const lifecycle = installDesktopLaunchLifecycle({
      app: fake.app,
      defaultApp: false,
      focusWindow,
    })!;
    lifecycle.captureInitial(
      ["/Applications/OpenKeep", "cold.pdf"],
      "/incoming",
    );
    const preventDefault = vi.fn();
    fake.handlers.get("open-file")?.({ preventDefault }, "/incoming/mac.png");

    const received: string[][] = [];
    await lifecycle.connect(async (paths) => {
      received.push(paths);
    });
    fake.handlers.get("second-instance")?.(
      {},
      ["/Applications/OpenKeep", "warm.tiff"],
      "/incoming",
    );
    await lifecycle.idle();

    expect(received).toEqual([
      ["/incoming/cold.pdf"],
      ["/incoming/mac.png"],
      ["/incoming/warm.tiff"],
    ]);
    expect(preventDefault).toHaveBeenCalledOnce();
    expect(focusWindow).toHaveBeenCalledTimes(2);
  });

  it("keeps delivering after one receiver failure", async () => {
    const fake = fakeApp();
    const lifecycle = installDesktopLaunchLifecycle({
      app: fake.app,
      defaultApp: false,
      focusWindow: vi.fn(),
    })!;
    const received: string[][] = [];
    const receiver = vi
      .fn(async (paths: string[]) => {
        received.push(paths);
      })
      .mockRejectedValueOnce(new Error("upload pipeline hiccup"));
    await lifecycle.connect(receiver);

    fake.handlers.get("second-instance")?.(undefined, ["openkeep", "/tmp/first.pdf"], "/");
    fake.handlers.get("second-instance")?.(undefined, ["openkeep", "/tmp/second.pdf"], "/");
    await lifecycle.idle();

    // The first delivery failed; the second still arrived.
    expect(received).toEqual([["/tmp/second.pdf"]]);
  });
});

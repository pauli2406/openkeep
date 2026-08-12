import { extractOpenWithPaths } from "./import-service";

type LaunchEvent = { preventDefault(): void };
type LaunchHandler = (...arguments_: unknown[]) => void;

type DesktopLifecycleApp = {
  requestSingleInstanceLock(): boolean;
  quit(): void;
  on(event: string, handler: LaunchHandler): unknown;
};

/**
 * Owns single-instance and operating-system launch delivery. Window policy is
 * injected so tray/background mode can later decide whether "focus" means
 * restore, reveal, or create without changing file-ingress semantics.
 */
export function installDesktopLaunchLifecycle({
  app,
  defaultApp,
  focusWindow,
}: {
  app: DesktopLifecycleApp;
  defaultApp: boolean;
  focusWindow: () => void;
}) {
  if (!app.requestSingleInstanceLock()) {
    app.quit();
    return null;
  }

  let receiver: ((paths: string[]) => Promise<void>) | null = null;
  const deferred: string[][] = [];
  let delivery = Promise.resolve();

  function dispatch(paths: string[]) {
    if (paths.length === 0) return;
    if (!receiver) {
      deferred.push(paths);
      return;
    }
    // Settle every link of the chain: one failed delivery must not leave the
    // chain rejected, or every later Open-with launch would be dropped
    // silently until the application restarts.
    delivery = delivery
      .then(() => receiver!(paths))
      .catch((error: unknown) => {
        console.error("OpenKeep could not deliver opened files.", error);
      });
  }

  app.on("second-instance", (...arguments_) => {
    const argv = arguments_[1] as string[];
    const workingDirectory = arguments_[2] as string;
    dispatch(extractOpenWithPaths(argv, workingDirectory, defaultApp));
    focusWindow();
  });

  app.on("open-file", (...arguments_) => {
    const event = arguments_[0] as LaunchEvent;
    const filePath = arguments_[1] as string;
    event.preventDefault();
    dispatch([filePath]);
    focusWindow();
  });

  return {
    captureInitial(argv: string[], workingDirectory: string) {
      dispatch(extractOpenWithPaths(argv, workingDirectory, defaultApp));
    },

    async connect(nextReceiver: (paths: string[]) => Promise<void>) {
      receiver = nextReceiver;
      for (const paths of deferred.splice(0)) dispatch(paths);
      await delivery;
    },

    async idle() {
      await delivery;
    },
  };
}

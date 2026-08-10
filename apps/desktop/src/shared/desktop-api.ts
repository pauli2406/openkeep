export const DESKTOP_CHANNELS = {
  connectionCheckHealth: "desktop:connection:check-health",
  runtimeGetInfo: "desktop:runtime:get-info",
} as const;

export type ConnectionCheckInput = {
  serverUrl: string;
};

export type ConnectionCheckResult =
  | {
      ok: true;
      serverUrl: string;
      serverStatus: string;
    }
  | {
      ok: false;
      code: "invalid-url" | "unreachable" | "unhealthy" | "invalid-response";
      message: string;
    };

export type DesktopRuntimeInfo = {
  platform: NodeJS.Platform;
  version: string;
};

export type DesktopBridge = {
  connection: {
    checkHealth: (input: ConnectionCheckInput) => Promise<ConnectionCheckResult>;
  };
  runtime: {
    getInfo: () => Promise<DesktopRuntimeInfo>;
  };
};

type Invoke = (channel: string, payload?: unknown) => Promise<unknown>;

export function createDesktopBridge(invoke: Invoke): DesktopBridge {
  return Object.freeze({
    connection: Object.freeze({
      checkHealth: (input: ConnectionCheckInput) =>
        invoke(DESKTOP_CHANNELS.connectionCheckHealth, input) as Promise<ConnectionCheckResult>,
    }),
    runtime: Object.freeze({
      getInfo: () =>
        invoke(DESKTOP_CHANNELS.runtimeGetInfo) as Promise<DesktopRuntimeInfo>,
    }),
  });
}

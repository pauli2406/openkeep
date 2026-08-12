import {
  createContext,
  useContext,
  type ComponentType,
  type ReactNode,
} from "react";

export type ShellAccessory = ComponentType;
export type HostPlatform = "darwin" | "win32" | "linux" | string;
/**
 * Whether the host transport is live or serving a read-only offline copy.
 * This is THE offline predicate: every mutating or AI surface gates on
 * `useOfflineReadOnly()` instead of deriving its own signal. (The mobile app
 * copy-pastes an equivalent check across nine screens; the web app gets one.)
 */
export type HostSessionMode = "online" | "offline";
export type HostSaveRequest =
  | { kind: "document-original"; documentId: string }
  | { kind: "document-searchable"; documentId: string }
  | { kind: "archive-export" };
export type HostSaveResult =
  | { status: "saved" }
  | { status: "cancelled" }
  | { status: "failed"; message: string };
export type HostFileSaver = (request: HostSaveRequest) => Promise<HostSaveResult>;

type HostShellContextValue = {
  accessory: ShellAccessory | null;
  platform?: HostPlatform;
  fileSaver: HostFileSaver | null;
  sessionMode: HostSessionMode;
};

const HostShellContext = createContext<HostShellContextValue>({
  accessory: null,
  fileSaver: null,
  sessionMode: "online",
});

export function ShellAccessoryProvider({
  accessory,
  platform,
  fileSaver,
  sessionMode,
  children,
}: {
  accessory?: ShellAccessory;
  platform?: HostPlatform;
  fileSaver?: HostFileSaver;
  sessionMode?: HostSessionMode;
  children: ReactNode;
}) {
  return (
    <HostShellContext.Provider
      value={{
        accessory: accessory ?? null,
        platform,
        fileSaver: fileSaver ?? null,
        sessionMode: sessionMode ?? "online",
      }}
    >
      {children}
    </HostShellContext.Provider>
  );
}

export function useHostSessionMode(): HostSessionMode {
  return useContext(HostShellContext).sessionMode;
}

/** True while the host serves a read-only offline copy of the archive. */
export function useOfflineReadOnly(): boolean {
  return useContext(HostShellContext).sessionMode === "offline";
}

export function useShellAccessory() {
  return useContext(HostShellContext).accessory;
}

export function useHostFileSaver() {
  return useContext(HostShellContext).fileSaver;
}

function browserPlatform(): HostPlatform | undefined {
  if (typeof navigator === "undefined") return undefined;
  const value = navigator.platform.toLowerCase();
  if (value.includes("mac")) return "darwin";
  if (value.includes("win")) return "win32";
  if (value.includes("linux")) return "linux";
  return undefined;
}

export function usePrimaryModifierLabel() {
  const platform = useContext(HostShellContext).platform ?? browserPlatform();
  return platform === "darwin" ? "⌘" : "Ctrl";
}

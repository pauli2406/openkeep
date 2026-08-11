import {
  createContext,
  useContext,
  type ComponentType,
  type ReactNode,
} from "react";

export type ShellAccessory = ComponentType;
export type HostPlatform = "darwin" | "win32" | "linux" | string;
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
};

const HostShellContext = createContext<HostShellContextValue>({
  accessory: null,
  fileSaver: null,
});

export function ShellAccessoryProvider({
  accessory,
  platform,
  fileSaver,
  children,
}: {
  accessory?: ShellAccessory;
  platform?: HostPlatform;
  fileSaver?: HostFileSaver;
  children: ReactNode;
}) {
  return (
    <HostShellContext.Provider
      value={{
        accessory: accessory ?? null,
        platform,
        fileSaver: fileSaver ?? null,
      }}
    >
      {children}
    </HostShellContext.Provider>
  );
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

import {
  createContext,
  useContext,
  type ComponentType,
  type ReactNode,
} from "react";

export type ShellAccessory = ComponentType;
export type HostPlatform = "darwin" | "win32" | "linux" | string;

type HostShellContextValue = {
  accessory: ShellAccessory | null;
  platform?: HostPlatform;
};

const HostShellContext = createContext<HostShellContextValue>({
  accessory: null,
});

export function ShellAccessoryProvider({
  accessory,
  platform,
  children,
}: {
  accessory?: ShellAccessory;
  platform?: HostPlatform;
  children: ReactNode;
}) {
  return (
    <HostShellContext.Provider value={{ accessory: accessory ?? null, platform }}>
      {children}
    </HostShellContext.Provider>
  );
}

export function useShellAccessory() {
  return useContext(HostShellContext).accessory;
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

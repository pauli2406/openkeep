import {
  createContext,
  useContext,
  type ComponentType,
  type ReactNode,
} from "react";

export type ShellAccessory = ComponentType;

const ShellAccessoryContext = createContext<ShellAccessory | null>(null);

export function ShellAccessoryProvider({
  accessory,
  children,
}: {
  accessory?: ShellAccessory;
  children: ReactNode;
}) {
  return (
    <ShellAccessoryContext.Provider value={accessory ?? null}>
      {children}
    </ShellAccessoryContext.Provider>
  );
}

export function useShellAccessory() {
  return useContext(ShellAccessoryContext);
}

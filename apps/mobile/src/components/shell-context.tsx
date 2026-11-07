import { createContext, useContext } from "react";
import type { HomeTabParamList } from "../../App";

/** What sits above every shell screen, for keyboard avoidance. */
export const SHELL_HEADER_HEIGHT = 56;

export type Shell = {
  active: keyof HomeTabParamList;
  setActive: (route: keyof HomeTabParamList) => void;
  openDrawer: () => void;
  closeDrawer: () => void;
  drawerOpen: boolean;
  openOmnibar: () => void;
  omnibarOpen: boolean;
  closeOmnibar: () => void;
};

export const ShellContext = createContext<Shell | null>(null);

/** Is this screen a primary destination, inside the header and drawer? */
export function useInShell() {
  return useContext(ShellContext) !== null;
}

export function useShell() {
  const shell = useContext(ShellContext);
  if (!shell) throw new Error("useShell must be used inside ShellProvider");
  return shell;
}

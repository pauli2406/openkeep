import { createContext, useContext, useMemo, useState, type ReactNode } from "react";

/**
 * Whether a list is in selection mode, shared with the shell.
 *
 * The scan button floats over the tab bar, in the same corner the bulk action bar
 * puts `Delete` — so while a selection is active the button has to go. The
 * selection lives in `DocumentsScreen`, the button lives in `App`, and this is
 * the smallest thing that can sit between them.
 */
type SelectionMode = {
  selecting: boolean;
  setSelecting: (selecting: boolean) => void;
};

const SelectionModeContext = createContext<SelectionMode>({
  selecting: false,
  setSelecting: () => {},
});

export function SelectionModeProvider({ children }: { children: ReactNode }) {
  const [selecting, setSelecting] = useState(false);
  const value = useMemo(() => ({ selecting, setSelecting }), [selecting]);
  return <SelectionModeContext.Provider value={value}>{children}</SelectionModeContext.Provider>;
}

export function useSelectionMode() {
  return useContext(SelectionModeContext);
}

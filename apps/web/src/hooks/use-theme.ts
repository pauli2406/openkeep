import { useCallback, useEffect, useState } from "react";

export type Theme = "light" | "dark";

/**
 * Drives the `data-theme` attribute the token layer keys off.
 *
 * #43 needs the top bar's toggle to do something; #44 owns persistence,
 * the system-preference default and the hard-coded-color audit.
 */
export function useTheme() {
  const [theme, setTheme] = useState<Theme>(() => {
    if (typeof document === "undefined") return "light";
    return document.documentElement.getAttribute("data-theme") === "dark"
      ? "dark"
      : "light";
  });

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  const toggleTheme = useCallback(() => {
    setTheme((current) => (current === "dark" ? "light" : "dark"));
  }, []);

  return { theme, setTheme, toggleTheme };
}

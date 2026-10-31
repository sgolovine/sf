import * as React from "react";
import { DARK_QUERY, isDark, readTheme, THEME_KEY, type Theme } from "@/lib/theme";

/** The Theme saved in this browser, applied as the `dark` class on `<html>`; "system" tracks OS changes live. */
export function useTheme() {
  const [theme, setThemeState] = React.useState<Theme>(() => readTheme(localStorage));

  React.useEffect(() => {
    const mql = window.matchMedia(DARK_QUERY);
    const apply = () => document.documentElement.classList.toggle("dark", isDark(theme, mql.matches));
    apply();
    if (theme !== "system") return;
    mql.addEventListener("change", apply);
    return () => mql.removeEventListener("change", apply);
  }, [theme]);

  const setTheme = React.useCallback((next: Theme) => {
    if (next === "system") localStorage.removeItem(THEME_KEY);
    else localStorage.setItem(THEME_KEY, next);
    setThemeState(next);
  }, []);

  return { theme, setTheme };
}

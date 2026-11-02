import * as React from "react";
import { DARK_QUERY, isDark, readTheme, THEME_KEY, type Theme } from "@/lib/theme";

/**
 * The Theme saved in this browser, applied as the `dark` class on `<html>`; "system" tracks OS changes live.
 * `dark` is the effective appearance. Use this hook in one place only: it owns the `<html>` class.
 */
export function useTheme() {
  const [theme, setThemeState] = React.useState<Theme>(() => readTheme(localStorage));
  const [systemDark, setSystemDark] = React.useState(() => window.matchMedia(DARK_QUERY).matches);
  const dark = isDark(theme, systemDark);

  React.useEffect(() => {
    const mql = window.matchMedia(DARK_QUERY);
    const sync = () => setSystemDark(mql.matches);
    sync();
    mql.addEventListener("change", sync);
    return () => mql.removeEventListener("change", sync);
  }, []);

  React.useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
  }, [dark]);

  const setTheme = React.useCallback((next: Theme) => {
    if (next === "system") localStorage.removeItem(THEME_KEY);
    else localStorage.setItem(THEME_KEY, next);
    setThemeState(next);
  }, []);

  return { theme, dark, setTheme };
}

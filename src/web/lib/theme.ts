/** Appearance chosen in this browser; "system" follows the OS. Kept out of `.sf` (viewer preference, not factory state). */
export type Theme = "light" | "dark" | "system";

/** localStorage key; `index.html` reads the same key before first paint. */
export const THEME_KEY = "sf-theme";

export const DARK_QUERY = "(prefers-color-scheme: dark)";

/** The saved Theme, or "system" when none (or an unknown value) is saved. */
export function readTheme(storage: Pick<Storage, "getItem">): Theme {
  const saved = storage.getItem(THEME_KEY);
  return saved === "light" || saved === "dark" ? saved : "system";
}

export function isDark(theme: Theme, systemDark: boolean): boolean {
  return theme === "dark" || (theme === "system" && systemDark);
}

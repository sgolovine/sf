import assert from "node:assert/strict";
import { test } from "node:test";
import { isDark, readTheme, THEME_KEY } from "../src/web/lib/theme.ts";

const storage = (value: string | null) => ({ getItem: (key: string) => (key === THEME_KEY ? value : null) });

test("readTheme returns the saved Theme and defaults to system", () => {
  assert.equal(readTheme(storage("dark")), "dark");
  assert.equal(readTheme(storage("light")), "light");
  assert.equal(readTheme(storage(null)), "system");
  assert.equal(readTheme(storage("purple")), "system");
});

test("isDark follows the OS only for the system Theme", () => {
  assert.equal(isDark("dark", false), true);
  assert.equal(isDark("light", true), false);
  assert.equal(isDark("system", true), true);
  assert.equal(isDark("system", false), false);
});

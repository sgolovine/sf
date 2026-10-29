import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { tempDir } from "./helpers.ts";

const main = path.resolve(import.meta.dirname, "../src/cli/main.ts");
const sf = (...args: string[]) =>
  spawnSync(process.execPath, ["--import", "tsx", main, ...args], {
    encoding: "utf8",
    env: { ...process.env, SF_PROJECT: tempDir() },
  });

test("--help lists setup and start", () => {
  const r = sf("--help");
  assert.equal(r.status, 0);
  assert.match(r.stdout, /sf setup/);
  assert.match(r.stdout, /sf start/);
});

test("--version prints sf <version>", () => {
  const r = sf("--version");
  assert.equal(r.status, 0);
  assert.match(r.stdout, /^sf \d/);
});

test("an unknown command exits 1", () => {
  assert.equal(sf("nope").status, 1);
});

test("setup installs only the skill's markdown", () => {
  const dir = tempDir();
  const r = sf("setup", "--agents", "claude-code", "--scope", "project", "--project-dir", dir, "--yes");
  assert.equal(r.status, 0, r.stderr);
  const skill = path.join(dir, ".claude/skills/sf");
  assert.ok(fs.existsSync(path.join(skill, "SKILL.md")));
  assert.ok(fs.existsSync(path.join(skill, "references/commands.md")));
  assert.ok(!fs.existsSync(path.join(skill, "scripts")));
  assert.ok(!fs.existsSync(path.join(skill, "assets")));
});

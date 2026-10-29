import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { sfCommand } from "../src/cli/sf-command.ts";
import { tempDir } from "./helpers.ts";

const none = () => null;

test("SF_COMMAND overrides everything", () => {
  assert.equal(
    sfCommand({ script: "/x/dist/sf.mjs", execPath: "/n/node", env: { SF_COMMAND: "my sf" }, which: none }),
    "my sf",
  );
});

test("from source, Workers run the sf-dev launcher", () => {
  const cmd = sfCommand({ script: "/repo/src/cli/main.ts", execPath: "/n/node", env: {}, which: none });
  assert.equal(cmd, "/n/node /repo/scripts/sf-dev.mjs");
});

test("bundled: `sf` when PATH's sf is this build, else the absolute command", () => {
  const dir = tempDir();
  const script = path.join(dir, "dist/sf.mjs");
  fs.mkdirSync(path.dirname(script));
  fs.writeFileSync(script, "");
  const link = path.join(dir, "sf");
  fs.symlinkSync(script, link);
  assert.equal(sfCommand({ script, execPath: "/n/node", env: {}, which: () => link }), "sf");
  // Some other `sf` on PATH, e.g. the Salesforce CLI.
  const other = path.join(dir, "other-sf");
  fs.writeFileSync(other, "");
  assert.equal(sfCommand({ script, execPath: "/n/node", env: {}, which: () => other }), `/n/node ${script}`);
  assert.equal(sfCommand({ script, execPath: "/n/node", env: {}, which: none }), `/n/node ${script}`);
});

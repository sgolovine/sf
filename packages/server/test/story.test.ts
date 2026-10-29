import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import type { FieldDef } from "@sf/protocol";
import { SfError } from "../src/project/errors.ts";
import { nextStoryNumber, parseFieldArg, parseStory, serializeStory, validateFields } from "../src/project/story.ts";
import { tempDir } from "./helpers.ts";

const schema: FieldDef[] = [
  { id: "notes", name: "Notes", type: "text" },
  { id: "points", name: "Points", type: "number" },
  { id: "priority", name: "Priority", type: "single-select", options: ["low", "high"] },
  { id: "tags", name: "Tags", type: "multi-select", options: ["ui", "api"] },
  { id: "urgent", name: "Urgent", type: "boolean" },
  { id: "due", name: "Due", type: "date" },
];

test("parse and serialize round-trip keeps unknown keys", () => {
  const text = "---\ntitle: Add dark mode\nstage: in_progress\nbranch: sf/DEV-3\npriority: high\nextra: kept\n---\nBody line\n";
  const story = parseStory(text);
  assert.equal(story.title, "Add dark mode");
  assert.equal(story.stage, "in_progress");
  assert.equal(story.branch, "sf/DEV-3");
  assert.deepEqual(story.fields, { priority: "high", extra: "kept" });
  assert.equal(story.body, "Body line\n");
  assert.equal(serializeStory(story), text);
});

test("dates stay strings through YAML", () => {
  const story = parseStory(serializeStory({ title: "t", stage: "backlog", fields: { due: "2026-01-02" }, body: "" }));
  assert.equal(story.fields.due, "2026-01-02");
});

test("nextStoryNumber is max + 1 for the Board key", () => {
  const dir = tempDir();
  assert.equal(nextStoryNumber(path.join(dir, "missing"), "DEV"), 1);
  for (const f of ["DEV-1.md", "DEV-7.md", "OPS-9.md", "notes.txt"]) fs.writeFileSync(path.join(dir, f), "");
  assert.equal(nextStoryNumber(dir, "DEV"), 8);
});

test("all six field types validate", () => {
  const fields = Object.fromEntries(
    ["notes=hi", "points=3", "priority=high", "tags=ui,api", "urgent=true", "due=2026-03-04"].map((a) =>
      parseFieldArg(schema, a),
    ),
  );
  assert.deepEqual(fields, { notes: "hi", points: 3, priority: "high", tags: ["ui", "api"], urgent: true, due: "2026-03-04" });
  validateFields(schema, fields);
  for (const bad of [{ points: "x" }, { priority: "mid" }, { tags: ["db"] }, { urgent: "yes" }, { due: "tomorrow" }, { notes: 1 }])
    assert.throws(() => validateFields(schema, bad), SfError);
});

test("parseFieldArg rejects unknown fields and clears on empty", () => {
  assert.throws(() => parseFieldArg(schema, "nope=1"), /unknown field/);
  assert.deepEqual(parseFieldArg(schema, "notes="), ["notes", null]);
});

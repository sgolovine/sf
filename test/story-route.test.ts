import assert from "node:assert/strict";
import { test } from "node:test";
import { parseStoryPath, storyPath } from "../src/web/lib/storyRoute.ts";

test("parseStoryPath reads create and Story Key paths", () => {
  assert.deepEqual(parseStoryPath("/"), { kind: "none" });
  assert.deepEqual(parseStoryPath("/create"), { kind: "create" });
  assert.deepEqual(parseStoryPath("/DEV-19"), { kind: "edit", key: "DEV-19" });
  assert.deepEqual(parseStoryPath("/A1-2"), { kind: "edit", key: "A1-2" });
});

test("parseStoryPath treats unrecognized paths as no dialog", () => {
  for (const p of ["", "/foo", "/dev-19", "/DEV-", "/DEV-19/", "/DEV/create", "/create/", "/1A-2", "/DEV-1x"]) {
    assert.deepEqual(parseStoryPath(p), { kind: "none" }, p);
  }
});

test("storyPath builds the path parseStoryPath reads", () => {
  for (const p of ["/", "/create", "/DEV-19"]) assert.equal(storyPath(parseStoryPath(p)), p);
});

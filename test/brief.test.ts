import assert from "node:assert/strict";
import { test } from "node:test";
import { composeBrief, shellQuote } from "../src/server/project/brief.ts";
import { defaultBoard } from "../src/server/project/config.ts";

test("brief sections are sf preamble, configured preamble, Stage Prompt, Story", () => {
  const board = defaultBoard("Development", "DEV");
  board.schema = [{ id: "priority", name: "Priority", type: "single-select", options: ["low", "high"] }];
  const brief = composeBrief({
    storyKey: "DEV-3",
    story: { title: "Add dark mode", stage: "todo", fields: { priority: "high" }, body: "Make it dark." },
    boardId: "development",
    board,
    stageId: "todo",
    root: "/abs/my repo",
    worktree: { path: "/abs/my repo-sf-worktrees/DEV-3", branch: "sf/DEV-3" },
    workerId: "w-1a2b",
    sf: "node /abs/sf.mjs",
    preamble: "Use pnpm.",
    prompt: "Plan it.",
  });
  const order = ["# sf Worker Brief: DEV-3", "Use pnpm.", "## Stage Prompt", "Plan it.", "## Story", "### DEV-3: Add dark mode", "- Priority: high", "Make it dark."];
  const positions = order.map((s) => brief.indexOf(s));
  assert.ok(positions.every((p) => p >= 0), String(positions));
  assert.deepEqual([...positions].sort((a, b) => a - b), positions);
  assert.match(brief, /node \/abs\/sf\.mjs story move DEV-3 <stage-id> --worker w-1a2b --project '\/abs\/my repo'/);
  assert.match(brief, /story release DEV-3 --worker w-1a2b/);
  assert.match(brief, /`todo`: TODO \(current\)/);
  assert.match(brief, /Never edit files under `\.sf`/);
});

test("shellQuote", () => {
  assert.equal(shellQuote("/a/b.mjs"), "/a/b.mjs");
  assert.equal(shellQuote("it's"), `'it'\\''s'`);
});

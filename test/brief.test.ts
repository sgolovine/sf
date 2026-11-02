import assert from "node:assert/strict";
import { test } from "node:test";
import {
  type BriefInput,
  composeBrief,
  machineRequest,
  machineSentence,
  shellQuote,
} from "../src/server/project/brief.ts";
import { defaultBoard } from "../src/server/project/config.ts";
import { remoteMachines, scheduling } from "./scheduling-fixture.ts";

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
  const order = [
    "# sf Worker Brief: DEV-3",
    "Use pnpm.",
    "## Stage Prompt",
    "Plan it.",
    "## Story",
    "### DEV-3: Add dark mode",
    "- Priority: high",
    "Make it dark.",
  ];
  const positions = order.map((s) => brief.indexOf(s));
  assert.ok(
    positions.every((p) => p >= 0),
    String(positions),
  );
  assert.deepEqual(
    [...positions].sort((a, b) => a - b),
    positions,
  );
  assert.match(brief, /node \/abs\/sf\.mjs story move DEV-3 <stage-id> --worker w-1a2b --project '\/abs\/my repo'/);
  for (const command of ["list DEV-3", "add DEV-3 <path>", "get DEV-3 <attachment-id> --output <path>"])
    assert.ok(brief.includes(`story attachment ${command} --worker w-1a2b --project '/abs/my repo'`));
  assert.match(brief, /story release DEV-3 --worker w-1a2b/);
  assert.match(brief, /`todo`: TODO \(current\)/);
  assert.match(brief, /Never edit files under `\.sf`/);
});

test("shellQuote", () => {
  assert.equal(shellQuote("/a/b.mjs"), "/a/b.mjs");
  assert.equal(shellQuote("it's"), `'it'\\''s'`);
});

test("the sf preamble tells the Worker how to ask for a human when its Stage has HIL fields", () => {
  const board = defaultBoard("Development", "DEV");
  board.schema = [
    { id: "dev_hil", name: "Dev HIL", type: "boolean" },
    { id: "dev_hil_comment", name: "Dev HIL comment", type: "text" },
  ];
  board.stages.find((s) => s.id === "in_progress")!.hil = { flag: "dev_hil", comment: "dev_hil_comment" };
  const brief = (stageId: string) =>
    composeBrief({
      storyKey: "DEV-3",
      story: { title: "T", stage: stageId, fields: {}, body: "" },
      boardId: "development",
      board,
      stageId,
      root: "/abs/repo",
      worktree: { path: "/abs/repo-sf-worktrees/DEV-3", branch: "sf/DEV-3" },
      workerId: "w-1",
      sf: "sf",
      preamble: "",
      prompt: "Build it.",
    });
  const line = 'sf story update DEV-3 --field dev_hil=true --field "dev_hil_comment=<what you need>" --worker w-1';
  assert.ok(brief("in_progress").includes(line));
  assert.ok(brief("in_progress").indexOf(line) < brief("in_progress").indexOf("## Stage Prompt"));
  assert.ok(!brief("todo").includes("dev_hil"));
});

const instructionBrief: BriefInput = {
  storyKey: "DEV-1",
  story: { title: "Instructions", stage: "todo", fields: {}, body: "Story body" },
  boardId: "development",
  board: defaultBoard("Development", "DEV"),
  stageId: "todo",
  root: "/project",
  worktree: { path: "/worktree", branch: "sf/DEV-1" },
  workerId: "w-1",
  sf: "sf",
  preamble: "Configured preamble",
  prompt: "Stage instructions",
};

test("instruction sections preserve Markdown and literal placeholders in order", () => {
  // biome-ignore lint/suspicious/noTemplateCurlyInString: instruction files must preserve literal placeholders.
  const projectInstructions = "# Shared\n\n  - Keep indent\n{{storyKey}} ${board}";
  const boardInstructions = "**Board only**\n\n```ts\nconst x = 1;\n```";
  const brief = composeBrief({
    ...instructionBrief,
    projectInstructions: ` \n${projectInstructions}\n`,
    boardInstructions,
  });
  const sections = [
    "Configured preamble",
    `## SF.md\n\n${projectInstructions}`,
    `## BOARD.md\n\n${boardInstructions}`,
    "## Stage Prompt",
    "## Story",
  ];
  let previous = -1;
  for (const section of sections) {
    const position = brief.indexOf(section);
    assert.ok(position > previous, section);
    previous = position;
  }
});

test("instruction files are independently optional and blank sections preserve the existing brief", () => {
  const original = composeBrief(instructionBrief);
  for (const projectInstructions of [undefined, "", " \n\t"]) {
    for (const boardInstructions of [undefined, "", " \n\t"]) {
      assert.equal(composeBrief({ ...instructionBrief, projectInstructions, boardInstructions }), original);
    }
    const boardOnly = composeBrief({ ...instructionBrief, projectInstructions, boardInstructions: "Board guidance" });
    assert.ok(!boardOnly.includes("## SF.md"));
    assert.ok(boardOnly.includes("## BOARD.md\n\nBoard guidance"));
  }
  for (const boardInstructions of [undefined, "", " \n\t"]) {
    const projectOnly = composeBrief({
      ...instructionBrief,
      projectInstructions: "Shared guidance",
      boardInstructions,
    });
    assert.ok(projectOnly.includes("## SF.md\n\nShared guidance"));
    assert.ok(!projectOnly.includes("## BOARD.md"));
  }
});

test("a selected remote appends the machine sentence after the unchanged brief; local omits it", () => {
  const remotes = remoteMachines();
  const config = scheduling();
  const sentence = "The user specified that this work should be done on the machine: a";
  const original = composeBrief({ ...instructionBrief, projectInstructions: "Shared", boardInstructions: "Board" });
  assert.equal(machineRequest(remotes, config, undefined, "local"), undefined, "local requests no machine");
  assert.ok(!original.includes("The user specified"), "a local brief has no machine sentence");
  const required = machineRequest(remotes, config, { mode: "required", machineId: "a" }, "a")!;
  assert.deepEqual(Object.keys(required).sort(), ["id", "instructions", "name"]);
  assert.deepEqual([required.id, required.name], ["a", "A"]);
  const brief = composeBrief({
    ...instructionBrief,
    projectInstructions: "Shared",
    boardInstructions: "Board",
    machine: required,
  });
  assert.equal(brief, `${original}\n${required.instructions}\n`, "everything before the machine section is preserved");
  assert.equal(machineSentence("a"), sentence);
  assert.ok(required.instructions.split("\n").includes(sentence), "the exact sentence is its own line");
  assert.ok(brief.includes(sentence));
  assert.doesNotMatch(required.instructions, /env-|project-|github\.com|Environment|Repository/);
  assert.match(required.instructions, /start nothing and report the launch as not started/);

  const preferred = machineRequest(remotes, config, { mode: "preferred", machineId: "b" }, "b")!;
  assert.ok(preferred.instructions.includes("The user specified that this work should be done on the machine: b"));
  assert.match(preferred.instructions, /may start it on the Supervisor's machine instead/);
  assert.match(machineRequest(remotes, { ...config, order: ["a"] }, undefined, "a")!.instructions, /start nothing/);
  // Without scheduling, a preferred remote falls back to local.
  assert.match(
    machineRequest(remotes, undefined, { mode: "preferred", machineId: "a" }, "a")!.instructions,
    /may start it/,
  );
});

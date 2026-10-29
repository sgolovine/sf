import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { createService } from "../src/project/service.ts";
import { worktreePath } from "../src/project/worktree.ts";
import { git, tempRepo } from "./helpers.ts";

const user = { kind: "user" } as const;

async function setup() {
  const root = tempRepo();
  const svc = createService({ root, online: true });
  svc.init();
  await svc.createBoard("Development", "DEV");
  return { root, svc };
}

test("ensure creates the worktree on sf/KEY from the base branch, records branch, and reuses it", async () => {
  const { root, svc } = await setup();
  await svc.createStory("DEV", { title: "One" }, user);
  const first = await svc.ensureStoryWorktree("DEV-1");
  assert.equal(first.path, path.join(path.dirname(root), "repo-sf-worktrees", "DEV-1"));
  assert.equal(first.created, true);
  assert.equal(git(first.path, "branch", "--show-current"), "sf/DEV-1");
  assert.equal(git(first.path, "rev-parse", "HEAD"), git(root, "rev-parse", "main"));
  assert.equal((await svc.showStory("DEV-1", user)).branch, "sf/DEV-1");
  const again = await svc.ensureStoryWorktree("DEV-1");
  assert.equal(again.created, false);
});

test("an existing branch is checked out instead of recreated", async () => {
  const { root, svc } = await setup();
  await svc.createStory("DEV", { title: "One" }, user);
  await svc.ensureStoryWorktree("DEV-1");
  const wt = worktreePath(root, "DEV-1");
  git(root, "worktree", "remove", wt);
  const again = await svc.ensureStoryWorktree("DEV-1");
  assert.equal(again.created, true);
  assert.equal(git(wt, "branch", "--show-current"), "sf/DEV-1");
});

test("Done removes a clean, pushed worktree and keeps the branch", async () => {
  const { root, svc } = await setup();
  await svc.createStory("DEV", { title: "One" }, user);
  const wt = await svc.ensureStoryWorktree("DEV-1");
  fs.writeFileSync(path.join(wt.path, "a.txt"), "a\n");
  git(wt.path, "add", ".");
  git(wt.path, "commit", "-m", "work");
  git(wt.path, "push", "-u", "origin", "sf/DEV-1");
  await svc.moveStory("DEV-1", "done", user);
  assert.equal(fs.existsSync(wt.path), false);
  assert.ok(git(root, "branch", "--list", "sf/DEV-1"));
  assert.deepEqual(svc.snapshot()!.runtime.worktreeWarnings, {});
});

test("Done keeps a dirty or unpushed worktree with a warning; force remove clears it", async () => {
  const { svc } = await setup();
  await svc.createStory("DEV", { title: "Dirty" }, user);
  await svc.createStory("DEV", { title: "Unpushed" }, user);
  const dirty = await svc.ensureStoryWorktree("DEV-1");
  fs.writeFileSync(path.join(dirty.path, "scratch.txt"), "x\n");
  const unpushed = await svc.ensureStoryWorktree("DEV-2");
  fs.writeFileSync(path.join(unpushed.path, "b.txt"), "b\n");
  git(unpushed.path, "add", ".");
  git(unpushed.path, "commit", "-m", "local only");

  await svc.moveStory("DEV-1", "done", user);
  await svc.moveStory("DEV-2", "done", user);
  const warnings = svc.snapshot()!.runtime.worktreeWarnings;
  assert.equal(warnings["DEV-1"]?.reason, "uncommitted changes");
  assert.equal(warnings["DEV-2"]?.reason, "unpushed commits");
  assert.ok(fs.existsSync(dirty.path));

  const kept = await svc.removeWorktree("DEV-1", false);
  assert.equal(kept.removed, false);
  const removed = await svc.removeWorktree("DEV-1", true);
  assert.equal(removed.removed, true);
  assert.equal(fs.existsSync(dirty.path), false);
  assert.equal(svc.snapshot()!.runtime.worktreeWarnings["DEV-1"], undefined);
});

test("an offline Done becomes a cleanup trigger run by drainPending", async () => {
  const { root, svc } = await setup();
  await svc.createStory("DEV", { title: "One" }, user);
  const wt = await svc.ensureStoryWorktree("DEV-1");
  const offline = createService({ root, online: false });
  await offline.moveStory("DEV-1", "done", user);
  assert.ok(fs.existsSync(wt.path));
  await svc.drainPending();
  assert.equal(fs.existsSync(wt.path), false);
});

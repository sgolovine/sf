import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { after, test } from "node:test";
import { promisify } from "node:util";
import { type ErrorResponse, routes, type StoryDetails } from "#model/api";
import type { CommandRecord } from "#model/commands";
import type { SessionState } from "#model/session";
import pkg from "../package.json" with { type: "json" };
import { createApp, listen } from "../src/server/server.ts";
import { ClientService, type ServerInfo } from "../src/server/services/ClientService.ts";
import { OnlineService } from "../src/server/services/OnlineService.ts";
import { StoreService } from "../src/server/services/StoreService.ts";
import { tempRepo } from "./helpers.ts";

const root = tempRepo();
const store = StoreService.create(root, null);
const service = OnlineService.create(store, { root, sf: "sf" });
const app = createApp({ store, service, token: "t", uiDir: null, onStop: () => {} });
const http = await listen(app, 0);
after(() => http.close());
const address = http.address();
const server: ServerInfo = { port: typeof address === "object" && address ? address.port : 0, token: "t", pid: 0 };
const call = <T>(method: string, path: string, body?: unknown) => ClientService.api<T>(server, method, path, body);

test("GET /api/state includes the package.json version", async () => {
  const state = await call<SessionState>("GET", routes.state);
  assert.equal(state.version, pkg.version);
});

test("a Move over HTTP spawns; next hands out worker.spawn with its worktree; done activates", async () => {
  await call("POST", routes.capabilities, {
    agent: "a",
    model: "m",
    app: "t3-code",
    canSpawnThreads: true,
    canSpawnSubagents: true,
  });
  await call("POST", routes.boards, { name: "Development", key: "DEV" });
  await call("PATCH", routes.stage("DEV", "todo"), { promptEnabled: true, prompt: "Plan it." });
  await call("POST", routes.stories, { board: "DEV", title: "One" });
  const moved = await call<StoryDetails>("POST", routes.storyMove("DEV-1"), { stage: "todo" });
  assert.equal(moved.claim?.status, "spawning");
  assert.equal(store.state.project?.runtime.claims["DEV-1"]?.workerId, moved.claim?.workerId);

  const record = await call<CommandRecord>("GET", `${routes.nextCommand}?wait=1`);
  assert.equal(record.command.type, "worker.spawn");
  if (record.command.type !== "worker.spawn") return;
  assert.equal(record.command.mode, "thread");
  assert.ok(fs.existsSync(record.command.worktree.path));
  const shown = await call<StoryDetails>("GET", routes.story("DEV-1"));
  assert.equal(shown.branch, "sf/DEV-1");

  await call("POST", routes.commandResult(record.id), { ok: true, result: "thread-123" });
  assert.equal((await call<StoryDetails>("GET", routes.story("DEV-1"))).claim?.status, "active");

  // Claimed: a user Move is rejected with 409.
  await assert.rejects(call("POST", routes.storyMove("DEV-1"), { stage: "in_review" }), { code: "claimed" });
  // Force-release ends the Claim; the Worker's next command is "claim is gone".
  const workerId = record.command.workerId;
  await call("POST", routes.storyForceRelease("DEV-1"), {});
  await assert.rejects(call("POST", routes.storyMove("DEV-1"), { stage: "in_review", worker: workerId }), {
    code: "claim_gone",
    message: "claim is gone",
  });
});

test("a spawn whose Claim is gone is cancelled, not handed out", async () => {
  await call("POST", routes.stories, { board: "DEV", title: "Two", stage: "todo" });
  await call("POST", routes.storyForceRelease("DEV-2"), {});
  assert.equal(await call("GET", `${routes.nextCommand}?wait=0`), null);
  assert.equal(store.state.commands.at(-1)?.status, "cancelled");
});

test("errors map to HTTP codes", async () => {
  await assert.rejects(call("PATCH", routes.stage("DEV", "backlog"), { name: "X" }), { code: "invalid" });
  await assert.rejects(call("GET", routes.story("DEV-99")), { code: "not_found" });
  const res = await fetch(`http://127.0.0.1:${server.port}${routes.storyMove("DEV-1")}`, {
    method: "POST",
    headers: { authToken: "t", "content-type": "application/json" },
    body: JSON.stringify({ stage: "in_review", worker: "w-nope" }),
  });
  assert.equal(res.status, 409);
});

test("model API and online CLI settings persist through all four levels", async () => {
  const { spawn } = await import("node:child_process");
  const path = await import("node:path");
  const cli = (...args: string[]) =>
    new Promise<StoryDetails>((resolve, reject) => {
      const proc = spawn(
        process.execPath,
        ["--import", "tsx", path.resolve("src/cli/main.ts"), ...args, "--project", root, "--json"],
        { env: process.env },
      );
      let stdout = "";
      let stderr = "";
      proc.stdout.on("data", (data) => {
        stdout += data;
      });
      proc.stderr.on("data", (data) => {
        stderr += data;
      });
      proc.on("error", reject);
      proc.on("exit", (code) => (code === 0 ? resolve(JSON.parse(stdout)) : reject(new Error(stderr))));
    });
  // CLI discovery points at this in-process server; async children leave it free to answer HTTP.
  const { sfPaths } = await import("../src/server/project/paths.ts");
  fs.writeFileSync(sfPaths(root).serverJson, JSON.stringify({ ...server, pid: process.pid }));
  await call("POST", routes.boards, { name: "Models", key: "MOD" });
  await cli("project", "set", "--model", "online-project", "--model-option", "online/custom");
  const p = await call<import("#model/api").ProjectSettingsResponse>("GET", routes.projectSettings);
  assert.equal(p.config.worker.model, "online-project");
  assert.ok(p.config.modelOptions!.some((o) => o.slug === "online/custom"));
  await cli("board", "set", "MOD", "--model", "online-board", "--model-option", "board/custom");
  await cli("stage", "set", "MOD", "backlog", "--model", "online-stage");
  const s = await cli("story", "create", "MOD", "--title", "Online", "--model", "online-story");
  assert.equal((await call<StoryDetails>("GET", routes.story(s.key))).effectiveModel!.source, "story");
  await cli("story", "update", s.key, "--model", "");
  assert.equal((await call<StoryDetails>("GET", routes.story(s.key))).effectiveModel!.model, "online-stage");
  await call("PATCH", routes.stage("MOD", "backlog"), { model: null });
  assert.equal((await call<StoryDetails>("GET", routes.story(s.key))).effectiveModel!.source, "board");
  await call("PATCH", routes.board("MOD"), { model: null });
  assert.equal((await call<StoryDetails>("GET", routes.story(s.key))).effectiveModel!.source, "project");
  await call("PATCH", routes.projectSettings, { model: null });
  assert.equal((await call<StoryDetails>("GET", routes.story(s.key))).effectiveModel!.source, "supervisor");
  await assert.rejects(
    call("PATCH", routes.board("MOD"), { schema: [{ id: "model", name: "Model", type: "text" }] }),
    /reserved/,
  );
});

test("DELETE Story uses service Claim checks, updates live state, and returns 404 on repetition", async () => {
  await call("POST", routes.boards, { name: "Deletion", key: "DEL" });
  await call("PATCH", routes.stage("DEL", "todo"), { promptEnabled: true, prompt: "Work" });
  const claimed = await call<StoryDetails>("POST", routes.stories, { board: "DEL", title: "Claimed", stage: "todo" });
  const request = (key: string, body?: unknown) =>
    fetch(`http://127.0.0.1:${server.port}${routes.story(key)}`, {
      method: "DELETE",
      headers: { authToken: "t", "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  for (const body of [undefined, { worker: claimed.claim!.workerId }]) {
    const res = await request(claimed.key, body);
    assert.equal(res.status, 409);
    assert.equal(((await res.json()) as ErrorResponse).code, "claimed");
  }
  await call("POST", routes.storyForceRelease(claimed.key), {});
  const stale = await request(claimed.key, { worker: claimed.claim!.workerId });
  assert.equal(stale.status, 409);
  assert.equal(((await stale.json()) as ErrorResponse).code, "claim_gone");
  const res = await request(claimed.key);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { key: claimed.key });
  assert.equal(store.state.project!.boards.find((b) => b.config.key === "DEL")!.stories.length, 0);
  for (const key of [claimed.key, "DEL-99"]) {
    const missing = await request(key);
    assert.equal(missing.status, 404);
    assert.equal(((await missing.json()) as ErrorResponse).code, "not_found");
  }
});

test("online CLI deletion calls HTTP with Worker credentials and refreshes the server snapshot", async () => {
  const runtime = path.join(root, ".sf/runtime");
  fs.mkdirSync(runtime, { recursive: true });
  fs.writeFileSync(path.join(runtime, "server.json"), JSON.stringify(server));
  const run = (...args: string[]) =>
    promisify(execFile)(process.execPath, [
      "--import",
      "tsx",
      path.resolve("src/cli/main.ts"),
      ...args,
      "--project",
      root,
      "--json",
    ]);
  const story = await call<StoryDetails>("POST", routes.stories, { board: "DEL", title: "CLI" });
  await assert.rejects(run("story", "delete", story.key, "--worker", "stale"), (err: unknown) => {
    assert.match((err as { stderr: string }).stderr, /claim is gone/);
    return true;
  });
  const deleted = await run("story", "delete", story.key);
  assert.deepEqual(JSON.parse(deleted.stdout), { key: story.key });
  assert.equal(store.state.project!.boards.find((b) => b.config.key === "DEL")!.stories.length, 0);
});

test("online CLI/API dependencies share validation, atomic wait and independent HIL holds", async () => {
  const main = path.resolve(import.meta.dirname, "../src/cli/main.ts");
  const run = async (...args: string[]) => {
    const { stdout } = await promisify(execFile)(process.execPath, [
      "--import",
      "tsx",
      main,
      ...args,
      "--project",
      root,
      "--json",
    ]);
    return JSON.parse(stdout) as StoryDetails;
  };
  // Make online CLI discovery explicit for this test server.
  fs.writeFileSync(path.join(root, ".sf/runtime/server.json"), JSON.stringify(server));
  const prerequisite = await call<StoryDetails>("POST", routes.stories, { board: "DEV", title: "Dependency API" });
  const dependent = await run(
    "story",
    "create",
    "DEV",
    "--title",
    "Online dependent",
    "--stage",
    "todo",
    "--depends-on",
    prerequisite.key,
  );
  assert.deepEqual(dependent.unresolvedDependencies, [prerequisite.key]);
  assert.equal(dependent.claim, undefined);
  await assert.rejects(call("PATCH", routes.story(prerequisite.key), { dependsOn: [dependent.key] }), {
    code: "invalid",
  });
  await assert.rejects(call("PATCH", routes.story(dependent.key), { dependsOn: ["DEV-99999"] }), { code: "invalid" });
  await call("POST", routes.storyMove(prerequisite.key), { stage: "done" });
  const woken = await call<StoryDetails>("GET", routes.story(dependent.key));
  assert.ok(woken.claim);
  const next = await call<StoryDetails>("POST", routes.stories, { board: "DEV", title: "Next prerequisite" });
  const waiting = await run(
    "story",
    "wait",
    dependent.key,
    "--depends-on",
    next.key,
    "--worker",
    woken.claim!.workerId,
  );
  assert.equal(waiting.claim, undefined);
  assert.equal(waiting.waitingOnDependencies, true);
  await assert.rejects(
    call("POST", routes.storyWait(dependent.key), { dependsOn: [next.key], worker: woken.claim!.workerId }),
    { code: "claim_gone" },
  );
  await run("story", "update", dependent.key, "--depends-on", "");
  assert.ok((await call<StoryDetails>("GET", routes.story(dependent.key))).claim);
});

import assert from "node:assert/strict";
import fs from "node:fs";
import { after, test } from "node:test";
import { routes, type StoryDetails } from "#model/api";
import type { CommandRecord } from "#model/commands";
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

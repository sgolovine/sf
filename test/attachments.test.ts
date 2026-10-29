import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { routes, type StoryDetails } from "#model/api";
import { ATTACHMENT_LIMIT, type Attachment } from "#model/attachment";
import { runProjectCommand } from "../src/cli/story.ts";
import { createService } from "../src/server/project/service.ts";
import { createApp, listen } from "../src/server/server.ts";
import { ClientService, type ServerInfo } from "../src/server/services/ClientService.ts";
import { StoreService } from "../src/server/services/StoreService.ts";
import { setupProject, tempDir, user, worker } from "./helpers.ts";

const bytes = Buffer.from([0, 255, 1, 13, 10, 128]);
const input = { name: "../same.svg", mediaType: "image/svg+xml", data: bytes.toString("base64") };

test("attachments round trip, persist, coexist, and never trigger a Worker on add", async () => {
  const { svc, root, spawns } = await setupProject();
  const story = await svc.createStory("DEV", { title: "Files", attachments: [input, input] }, user);
  const files = await svc.listAttachments(story.key, user);
  assert.equal(files.length, 2);
  assert.notEqual(files[0]!.id, files[1]!.id);
  assert.equal(files[0]!.name, "../same.svg");
  const restarted = createService({ root, online: false });
  assert.deepEqual((await restarted.getAttachment(story.key, files[0]!.id, user)).bytes, bytes);
  await svc.updateStory(story.key, { title: "Edited" }, user);
  await svc.moveStory(story.key, "done", user);
  await svc.addAttachment(story.key, { ...input, mediaType: "unknown" }, user);
  assert.equal((await svc.listAttachments(story.key, user))[2]!.mediaType, "application/octet-stream");
  assert.equal(spawns.length, 0);
  assert.deepEqual((await svc.getAttachment(story.key, files[1]!.id, user)).bytes, bytes);
});

test("submission retry does not duplicate Story, files, or trigger; files precede creation and HIL wake", async () => {
  const root = tempDir();
  let observed = 0;
  const { svc } = await setupProject({
    root,
    onSpawn: (request) => {
      const manifest = path.join(root, ".sf/boards/development/attachments", request.storyKey, "manifest.json");
      observed += JSON.parse(fs.readFileSync(manifest, "utf8")).files.length;
      return "spawn";
    },
  });
  const submission = { title: "With files", stage: "todo", attachments: [input], submissionId: crypto.randomUUID() };
  const first = await svc.createStory("DEV", submission, user);
  assert.equal((await svc.createStory("DEV", submission, user)).key, first.key);
  assert.equal(svc.listStories().length, 1);
  assert.equal((await svc.listAttachments(first.key, user)).length, 1);
  assert.equal(observed, 1);
  await svc.updateBoard("DEV", { schema: [{ id: "hold", name: "Hold", type: "boolean" }] });
  await svc.updateStage("DEV", "todo", { hilFlag: "hold" });
  const held = await svc.createStory("DEV", { title: "Held", stage: "todo", fields: { hold: true } }, user);
  const patch = { fields: { hold: false }, attachments: [input], submissionId: crypto.randomUUID() };
  await svc.updateStory(held.key, patch, user);
  await svc.updateStory(held.key, patch, user);
  assert.equal(observed, 2);
  assert.equal((await svc.listAttachments(held.key, user)).length, 1);
});

test("invalid batches leave no Story or trigger, preserve existing Story and files", async () => {
  const { svc, spawns } = await setupProject();
  const bad = { ...input, data: Buffer.alloc(ATTACHMENT_LIMIT + 1).toString("base64") };
  await assert.rejects(
    svc.createStory("DEV", { title: "Bad", stage: "todo", attachments: [input, bad] }, user),
    /20 MiB/,
  );
  assert.equal(svc.listStories().length, 0);
  assert.equal(spawns.length, 0);
  const story = await svc.createStory("DEV", { title: "Original", attachments: [input] }, user);
  await assert.rejects(svc.updateStory(story.key, { title: "Changed", attachments: [bad] }, user), /20 MiB/);
  assert.equal((await svc.showStory(story.key, user)).title, "Original");
  assert.equal((await svc.listAttachments(story.key, user)).length, 1);
  await assert.rejects(svc.addAttachment(story.key, { ...input, data: "%%%" }, user), /base64/);
  await assert.rejects(svc.addAttachment(story.key, { ...input, name: "" }, user), /filename/);
  await assert.rejects(svc.getAttachment(story.key, "../../secret", user), /invalid attachment id/);
  await assert.rejects(svc.getAttachment(story.key, crypto.randomUUID(), user), /no attachment/);
  await assert.rejects(svc.listAttachments("DEV-999", user), /no Story/);
});

test("symlinks in storage or bytes are rejected", async () => {
  const { svc, root } = await setupProject();
  const story = await svc.createStory("DEV", { title: "Safe", attachments: [input] }, user);
  const file = (await svc.listAttachments(story.key, user))[0]!;
  const dir = path.join(root, ".sf/boards/development/attachments", story.key);
  fs.unlinkSync(path.join(dir, file.id));
  fs.symlinkSync(path.join(root, ".sf/sf.config.json"), path.join(dir, file.id));
  await assert.rejects(svc.getAttachment(story.key, file.id, user), /symlink/);
  fs.renameSync(dir, `${dir}-old`);
  fs.symlinkSync(`${dir}-old`, dir);
  await assert.rejects(svc.addAttachment(story.key, input, user), /symlink/);
});

test("all operations refresh Worker Claims and reject expired Claims", async () => {
  const { svc, clock, root } = await setupProject({ config: { claimTimeoutMinutes: 1 } });
  const story = await svc.createStory("DEV", { title: "Claimed", stage: "todo" }, user);
  const actor = worker(story.claim!.workerId);
  clock.advance(40_000);
  const file = await svc.addAttachment(story.key, input, actor);
  clock.advance(40_000);
  await svc.listAttachments(story.key, actor);
  clock.advance(40_000);
  await svc.getAttachment(story.key, file.id, actor);
  clock.advance(61_000);
  for (const run of [
    () => svc.addAttachment(story.key, input, actor),
    () => svc.listAttachments(story.key, actor),
    () => svc.getAttachment(story.key, file.id, actor),
  ]) {
    await assert.rejects(run(), { code: "claim_gone" });
  }
  assert.ok(fs.existsSync(path.join(root, ".sf/boards/development/attachments", story.key, file.id)));
});

test("HTTP and CLI online/offline byte-exact transfers, authentication and errors", async () => {
  const { svc, root } = await setupProject({ online: false });
  const store = StoreService.create(root, null);
  const server = await listen(createApp({ store, service: svc, token: "secret", uiDir: null, onStop: () => {} }), 0);
  try {
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const info: ServerInfo = { port: address.port, token: "secret", pid: 0 };
    const call = <T>(method: string, route: string, body?: unknown) => ClientService.api<T>(info, method, route, body);
    const story = await call<StoryDetails>("POST", routes.stories, {
      board: "DEV",
      title: "HTTP",
      attachments: [input],
    });
    for (const route of [routes.storyAttachments(story.key), routes.storyAttachment(story.key, crypto.randomUUID())]) {
      assert.equal((await fetch(`http://127.0.0.1:${info.port}${route}`)).status, 403);
    }
    const forbidden = await fetch(`http://127.0.0.1:${info.port}${routes.storyAttachments(story.key)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    });
    assert.equal(forbidden.status, 403);
    const files = await call<Attachment[]>("GET", routes.storyAttachments(story.key));
    assert.deepEqual(await ClientService.download(info, routes.storyAttachment(story.key, files[0]!.id)), bytes);
    const response = await fetch(`http://127.0.0.1:${info.port}${routes.storyAttachment(story.key, files[0]!.id)}`, {
      headers: { authToken: "secret" },
    });
    assert.equal(response.headers.get("content-type"), "application/octet-stream");
    assert.match(response.headers.get("content-disposition")!, /^attachment/);
    await assert.rejects(
      call("POST", routes.storyAttachments(story.key), {
        ...input,
        data: Buffer.alloc(ATTACHMENT_LIMIT + 1).toString("base64"),
      }),
      /20 MiB/,
    );
    await assert.rejects(call("GET", `${routes.storyAttachments(story.key)}?worker=ended`), { code: "claim_gone" });
    const source = path.join(root, "source.bin");
    fs.writeFileSync(source, bytes);
    for (const transport of [info, null]) {
      const before = await svc.listAttachments(story.key, user);
      await runProjectCommand("story", ["attachment", "add", story.key, source], { json: true }, root, transport);
      const after = await svc.listAttachments(story.key, user);
      assert.equal(after.length, before.length + 1);
      await runProjectCommand("story", ["attachment", "list", story.key], { json: true }, root, transport);
      const output = path.join(root, `result-${after.length}.bin`);
      const args = ["attachment", "get", story.key, after.at(-1)!.id];
      await runProjectCommand("story", args, { output, json: true }, root, transport);
      assert.deepEqual(fs.readFileSync(output), bytes);
      await assert.rejects(runProjectCommand("story", args, { output }, root, transport), /already exists/);
      await assert.rejects(
        runProjectCommand("story", args, { output: path.join(root, "missing/output") }, root, transport),
        /ENOENT/,
      );
      await assert.rejects(
        runProjectCommand("story", ["attachment", "add", story.key, root], {}, root, transport),
        /regular file/,
      );
      await assert.rejects(
        runProjectCommand("story", ["attachment", "add", story.key, `${source}-missing`], {}, root, transport),
        /ENOENT/,
      );
    }
  } finally {
    server.close();
  }
});

test("disk failures roll back creation and existing edits without spawning", async (t) => {
  const { svc, root, spawns } = await setupProject();
  const story = await svc.createStory("DEV", { title: "Keep", attachments: [input] }, user);
  const files = await svc.listAttachments(story.key, user);
  const rename = fs.renameSync;
  t.mock.method(fs, "renameSync", (from: fs.PathLike, to: fs.PathLike) => {
    if (String(to).endsWith("manifest.json")) throw new Error("simulated full disk");
    return rename(from, to);
  });
  await assert.rejects(svc.updateStory(story.key, { title: "Lose", attachments: [input] }, user), /full disk/);
  assert.equal((await svc.showStory(story.key, user)).title, "Keep");
  assert.deepEqual(await svc.listAttachments(story.key, user), files);
  const dir = path.join(root, ".sf/boards/development/attachments", story.key);
  assert.equal(fs.readdirSync(dir).filter((name) => /^[a-f0-9-]{36}$/.test(name)).length, 1);
  await assert.rejects(
    svc.createStory("DEV", { title: "Fail", stage: "todo", attachments: [input] }, user),
    /full disk/,
  );
  assert.equal(svc.listStories().length, 1);
  assert.equal(spawns.length, 0);
  t.mock.restoreAll();
  const created = await svc.createStory("DEV", { title: "Retry", attachments: [input] }, user);
  assert.equal(created.key, "DEV-2");
  assert.equal((await svc.listAttachments(created.key, user)).length, 1);
});

test("empty lists, exact file limit, batch/count limits, and invalid submission ids", async () => {
  const { svc } = await setupProject({ online: false });
  const story = await svc.createStory("DEV", { title: "Empty" }, user);
  assert.deepEqual(await svc.listAttachments(story.key, user), []);
  const limit = { ...input, data: Buffer.alloc(ATTACHMENT_LIMIT).toString("base64") };
  assert.equal((await svc.addAttachment(story.key, limit, user)).size, ATTACHMENT_LIMIT);
  await assert.rejects(svc.updateStory(story.key, { attachments: [limit, limit, input] }, user), /40 MiB/);
  await assert.rejects(
    svc.updateStory(story.key, { attachments: Array.from({ length: 101 }, () => input) }, user),
    /100 attachments/,
  );
  await assert.rejects(svc.createStory("DEV", { title: "Bad id", submissionId: "../bad" }, user), /submission id/);
  assert.equal((await svc.listAttachments(story.key, user)).length, 1);
});

test("partially written upload bytes are removed on failure", async (t) => {
  const { svc, root } = await setupProject();
  const story = await svc.createStory("DEV", { title: "Partial" }, user);
  const write = fs.writeFileSync;
  t.mock.method(fs, "writeFileSync", (...args: Parameters<typeof fs.writeFileSync>) => {
    if (typeof args[0] === "number") {
      write(args[0], Buffer.from([1]));
      throw new Error("partial write");
    }
    return write(...args);
  });
  await assert.rejects(svc.addAttachment(story.key, input, user), /partial write/);
  assert.deepEqual(await svc.listAttachments(story.key, user), []);
  const dir = path.join(root, ".sf/boards/development/attachments", story.key);
  assert.deepEqual(fs.readdirSync(dir), []);
});

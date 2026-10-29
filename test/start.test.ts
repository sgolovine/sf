import assert from "node:assert/strict";
import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { after, test } from "node:test";
import { routes, TOKEN_HEADER } from "#model/api";
import { sfPaths } from "../src/server/project/paths.ts";
import type { ServerInfo } from "../src/server/services/ClientService.ts";
import { tempDir, tempRepo } from "./helpers.ts";

const main = path.resolve(import.meta.dirname, "../src/cli/main.ts");
const env = { ...process.env, SF_NO_OPEN: "1" };
const ui = tempDir();
fs.writeFileSync(path.join(ui, "index.html"), "<p>fixture ui</p>");
const children: ChildProcess[] = [];
after(() => {
  for (const c of children) c.kill("SIGKILL");
});

const sfArgs = (repo: string, ...args: string[]) => ["--import", "tsx", main, ...args, "--project", repo];
const startArgs = (repo: string) => sfArgs(repo, "start", "--no-open", "--ui-dir", ui);
const sf = (repo: string, ...args: string[]) =>
  spawnSync(process.execPath, sfArgs(repo, ...args), { encoding: "utf8", env });

/** Spawns a process and resolves once its stdout contains `sf ready:`. */
function spawnReady(args: string[]) {
  const child = spawn(process.execPath, args, { env, stdio: ["ignore", "pipe", "pipe"] });
  children.push(child);
  let out = "";
  const ready = new Promise<string>((resolve, reject) => {
    child.stdout!.on("data", (d) => {
      out += d;
      if (out.includes("sf ready:")) resolve(out);
    });
    child.on("exit", (code) => reject(new Error(`exited ${code} before ready: ${out}`)));
  });
  const exited = new Promise<number | null>((resolve) => child.on("exit", (code) => resolve(code)));
  return { child, ready, exited, output: () => out };
}

const serverInfo = (repo: string) => JSON.parse(fs.readFileSync(sfPaths(repo).serverJson, "utf8")) as ServerInfo;
const get = (info: ServerInfo, pathname: string, token?: string) =>
  fetch(`http://127.0.0.1:${info.port}${pathname}`, { headers: token ? { [TOKEN_HEADER]: token } : {} });
const refuses = (info: ServerInfo) =>
  get(info, "/").then(
    () => false,
    () => true,
  );

async function until(check: () => boolean | Promise<boolean>, ms = 5000) {
  for (const end = Date.now() + ms; Date.now() < end; await new Promise((r) => setTimeout(r, 100)))
    if (await check()) return;
  assert.fail("timed out");
}

test("start runs in the foreground, serves the UI and API, and stops on SIGTERM", async () => {
  const repo = tempRepo();
  const { child, ready, exited, output } = spawnReady(startArgs(repo));
  assert.match(await ready, /sf ready: http:\/\/127\.0\.0\.1:\d+\/#authToken=/);
  const info = serverInfo(repo);
  assert.equal(info.pid, child.pid);
  assert.equal(await (await get(info, "/")).text(), "<p>fixture ui</p>");
  assert.equal((await get(info, routes.state, info.token)).status, 200);
  assert.equal((await get(info, routes.state)).status, 403);

  const second = sf(repo, "start", "--no-open");
  assert.equal(second.status, 1);
  assert.match(second.stderr, /already running/);

  child.kill("SIGTERM");
  assert.equal(await exited, 0);
  assert.match(output(), /sf stopped \(SIGTERM\)/);
  assert.ok(!fs.existsSync(sfPaths(repo).serverJson));
  assert.ok(await refuses(info));
});

test("start stops when the process that started it dies", async () => {
  const repo = tempRepo();
  const parentScript = `require("node:child_process").spawn(process.execPath, ${JSON.stringify(startArgs(repo))}, { stdio: "inherit" }); setInterval(() => {}, 1000);`;
  const { child, ready } = spawnReady(["-e", parentScript]);
  await ready;
  const info = serverInfo(repo);
  assert.notEqual(info.pid, child.pid);
  child.kill("SIGKILL");
  await until(() => !fs.existsSync(sfPaths(repo).serverJson));
  await until(() => refuses(info));
});

test("start stops when the wrapper that started it is orphaned", async () => {
  const repo = tempRepo();
  const spawnScript = (args: string[]) =>
    `require("node:child_process").spawn(process.execPath, ${JSON.stringify(args)}, { stdio: "inherit" }); setInterval(() => {}, 1000);`;
  const wrapper = `console.log("wrapper " + process.pid); ${spawnScript(startArgs(repo))}`;
  const { child, ready, output } = spawnReady(["-e", spawnScript(["-e", wrapper])]);
  await ready;
  const wrapperPid = Number(/wrapper (\d+)/.exec(output())![1]);
  after(() => {
    try {
      process.kill(wrapperPid, "SIGKILL");
    } catch {
      // Already gone.
    }
  });
  const info = serverInfo(repo);
  child.kill("SIGKILL");
  await until(() => !fs.existsSync(sfPaths(repo).serverJson));
  await until(() => refuses(info));
  process.kill(wrapperPid, 0); // The wrapper itself is still alive.
});

test("sf stop stops a running start; url fails without a server", async () => {
  const repo = tempRepo();
  const { ready, exited } = spawnReady(startArgs(repo));
  await ready;
  const stopped = sf(repo, "stop");
  assert.equal(stopped.stdout.trim(), "stopped");
  assert.equal(await exited, 0);
  assert.equal(sf(repo, "stop").stdout.trim(), "not running");

  const url = sf(repo, "url");
  assert.equal(url.status, 1);
  assert.match(url.stderr, /not running/);
});

test("sf stop never signals the pid of a stale server.json", async () => {
  const repo = tempRepo();
  const sleeper = spawn("sleep", ["300"], { stdio: "ignore" });
  children.push(sleeper);
  const free = net.createServer().listen(0, "127.0.0.1");
  await once(free, "listening");
  const port = (free.address() as net.AddressInfo).port;
  await new Promise((r) => free.close(r));
  const file = sfPaths(repo).serverJson;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ port, token: "t", pid: sleeper.pid }));

  assert.equal(sf(repo, "stop").stdout.trim(), "not running (removed stale server.json)");
  assert.ok(!fs.existsSync(file));
  await new Promise((r) => setTimeout(r, 200));
  assert.equal(sleeper.exitCode, null);
  assert.equal(sleeper.signalCode, null);
});

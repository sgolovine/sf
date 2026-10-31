import assert from "node:assert/strict";
import { after, test } from "node:test";
import { routes, type SearchResponse } from "#model/api";
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
const search = (q: string) => ClientService.api<SearchResponse>(server, "GET", routes.search(q));

await service.createBoard("Development", "DEV");
await service.createBoard("Website", "WEB");
for (const title of ["Story Search", "Login page", "Searchable list"])
  await service.createStory("DEV", { title }, { kind: "user" });
await service.createStory("WEB", { title: "Search bar", stage: "todo" }, { kind: "user" });

test("search matches titles across Boards, best first, with Board and Stage names", async () => {
  const results = await search("search");
  assert.deepEqual(results.map((r) => r.key).sort(), ["DEV-1", "DEV-3", "WEB-1"]);
  assert.deepEqual(
    results.find((r) => r.key === "WEB-1"),
    { key: "WEB-1", title: "Search bar", board: { id: "website", name: "Website" }, stage: { id: "todo", name: "TODO" } },
  );
  // A prefix match ("Search…") outranks a match later in the title ("Story Search").
  assert.ok(results.findIndex((r) => r.key === "WEB-1") < results.findIndex((r) => r.key === "DEV-1"));
  assert.ok((await search("srch")).some((r) => r.key === "DEV-1"));
});

test("search matches Story keys", async () => {
  assert.equal((await search("DEV-2"))[0]?.key, "DEV-2");
  assert.equal((await search("dev2"))[0]?.key, "DEV-2");
  assert.deepEqual(await search("zzzz"), []);
});

test("an empty, blank, or missing query returns []", async () => {
  assert.deepEqual(await search(""), []);
  assert.deepEqual(await search("   "), []);
  assert.deepEqual(await ClientService.api(server, "GET", "/api/search"), []);
});

test("results are capped", async () => {
  for (let i = 0; i < 52; i++) await service.createStory("WEB", { title: `Bulk ${i}` }, { kind: "user" });
  assert.equal((await search("bulk")).length, 50);
  assert.equal(service.searchStories("bulk", 5).length, 5);
});

test("search requires the token", async () => {
  const res = await fetch(`http://127.0.0.1:${server.port}${routes.search("dev")}`);
  assert.equal(res.status, 403);
});

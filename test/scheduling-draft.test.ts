import assert from "node:assert/strict";
import { test } from "node:test";
import type { SchedulingConfig } from "../src/model/config.ts";
import { blankRemote, draftScheduling, slotId, toScheduling } from "../src/web/lib/schedulingDraft.ts";

const remote = (id: string): SchedulingConfig["remotes"][number] => ({
  id,
  name: id,
  environmentId: `env-${id}`,
  project: { projectId: `p-${id}`, repository: "github.com/o/r" },
  enabled: true,
  capacity: 2,
});
const config: SchedulingConfig = {
  local: { capacity: 4 },
  remotes: [remote("gpu"), remote("arm")],
  order: ["arm", "local", "gpu"],
};

test("a scheduling draft round-trips the saved config", () => {
  assert.deepEqual(toScheduling("4", draftScheduling(config)), config);
  assert.deepEqual(draftScheduling(undefined), { remotes: [], order: ["local"] });
});

test("renaming a remote by clearing and retyping its ID keeps its order position", () => {
  const draft = draftScheduling(config);
  for (const id of ["gp", "g", "", "b", "bo", "box"]) {
    draft.remotes = draft.remotes.map((r) => (r.key === "#0" ? { ...r, id } : r));
    assert.equal(slotId(draft.order[2]!, draft.remotes), id);
  }
  assert.deepEqual(toScheduling("4", draft).order, ["arm", "local", "box"]);
});

test("new remotes get a key no existing row holds", () => {
  const draft = draftScheduling(config);
  const added = blankRemote(draft.remotes);
  assert.ok(!draft.remotes.some((r) => r.key === added.key));
  assert.equal(blankRemote([...draft.remotes, added]).key, "#3");
});

test("blank capacities become NaN for the server to reject", () => {
  const draft = draftScheduling(config);
  draft.remotes[0]!.capacity = " ";
  assert.ok(Number.isNaN(toScheduling("", draft).local.capacity));
  assert.ok(Number.isNaN(toScheduling("4", draft).remotes[0]!.capacity));
});

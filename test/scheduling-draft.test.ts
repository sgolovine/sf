import assert from "node:assert/strict";
import { test } from "node:test";
import type { RemoteMachine } from "../src/model/config.ts";
import { blankRemote, draftRemotes, followOrder, toRemoteMachines } from "../src/web/lib/schedulingDraft.ts";

const catalog: RemoteMachine[] = [
  { id: "gpu", name: "GPU box", enabled: true, capacity: 2 },
  { id: "arm", name: "ARM box", enabled: false },
];

test("a remote machine draft round-trips the saved catalog, explicit and inherited capacity", () => {
  assert.deepEqual(toRemoteMachines(draftRemotes(catalog)), catalog);
  assert.deepEqual(draftRemotes(undefined), []);
  assert.equal(draftRemotes(catalog)[1]!.capacity, "", "inherited capacity is blank");
});

test("clearing a capacity restores inheritance; zero stays explicit; other text is sent for validation", () => {
  const drafts = draftRemotes(catalog);
  drafts[0]!.capacity = " ";
  assert.equal(Object.hasOwn(toRemoteMachines(drafts)[0]!, "capacity"), false);
  drafts[0]!.capacity = "0";
  assert.equal(toRemoteMachines(drafts)[0]!.capacity, 0);
  drafts[0]!.capacity = "1.5";
  assert.equal(toRemoteMachines(drafts)[0]!.capacity, 1.5);
});

test("renaming a slug by clearing and retyping it keeps its order position; removal drops it", () => {
  const drafts = draftRemotes(catalog);
  for (const id of ["gp", "g", "", "b", "bo", "box"]) {
    drafts[0]!.id = id;
    assert.deepEqual(followOrder(["arm", "local", "gpu"], drafts), ["arm", "local", id]);
  }
  assert.deepEqual(followOrder(["arm", "local", "gpu"], drafts.slice(0, 1)), ["local", "box"]);
});

test("new remotes get a key no existing row holds and inherit capacity", () => {
  const drafts = draftRemotes(catalog);
  const added = blankRemote(drafts);
  assert.ok(!drafts.some((r) => r.key === added.key));
  assert.equal(blankRemote([...drafts, added]).key, "#3");
  assert.deepEqual(toRemoteMachines([added]), [{ id: "", name: "", enabled: true }]);
  assert.deepEqual(followOrder(["local"], [...drafts, { ...added, id: "new" }]), ["local"]);
});

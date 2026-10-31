import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ELIGIBILITY_REASONS,
  normalizePlacementPolicy,
  type StoryPlacement,
  selectPlacement,
  type TargetEligibility,
} from "#model/placement";

import { scheduling } from "./scheduling-fixture.ts";

const eligible: Record<string, TargetEligibility> = Object.fromEntries(
  ["a", "b", "local"].map((id) => [id, { failures: [] }]),
);

test("pure first-fit fills 4 + 2 + 2 independent of the legacy cap", () => {
  for (const maxConcurrentWorkers of [3, 1, 100]) {
    const config = { scheduling: scheduling(), maxConcurrentWorkers };
    const policy = normalizePlacementPolicy(config);
    const usage: Record<string, number> = {};
    const before = JSON.stringify({ config, policy, eligible });
    const selected = [];
    for (let n = 0; n < 8; n++) {
      const result = selectPlacement(policy, undefined, eligible, usage);
      assert.equal(result.kind, "selected");
      if (result.kind !== "selected") throw new Error("expected selection");
      selected.push(result.machineId);
      usage[result.machineId] = (usage[result.machineId] ?? 0) + 1;
    }
    assert.deepEqual(selected, ["a", "a", "a", "a", "b", "b", "local", "local"]);
    const full = { kind: "wait", reasons: ["a", "b", "local"].map((machineId) => ({ machineId, code: "capacity" })) };
    assert.deepEqual(selectPlacement(policy, undefined, eligible, usage), full);
    assert.deepEqual(selectPlacement(policy, undefined, eligible, usage), full);
    assert.equal(JSON.stringify({ config, policy, eligible }), before);
    assert.deepEqual(usage, { a: 4, b: 2, local: 2 });
  }
  assert.deepEqual(normalizePlacementPolicy({ maxConcurrentWorkers: 3 }), {
    machines: { local: { capacity: 3, enabled: true } },
    order: ["local"],
  });
  assert.equal(normalizePlacementPolicy({} as never).machines.local?.capacity, 3);
});

test("override candidates, fallback and preferred stable deduplication", () => {
  const policy = normalizePlacementPolicy({ scheduling: scheduling(), maxConcurrentWorkers: 3 });
  const cases: [StoryPlacement, Record<string, number>, string][] = [
    [{ mode: "inherit" }, {}, "a"],
    [{ mode: "local-only" }, {}, "local"],
    [{ mode: "required", machineId: "b" }, {}, "b"],
    [{ mode: "preferred", machineId: "b" }, {}, "b"],
    [{ mode: "preferred", machineId: "b" }, { b: 2 }, "a"],
  ];
  for (const [placement, usage, machineId] of cases)
    assert.deepEqual(selectPlacement(policy, placement, eligible, usage), { kind: "selected", machineId });
  assert.deepEqual(selectPlacement(policy, { mode: "required", machineId: "b" }, eligible, { b: 2 }), {
    kind: "wait",
    reasons: [{ machineId: "b", code: "capacity" }],
  });
  assert.deepEqual(selectPlacement(policy, { mode: "local-only" }, eligible, { local: 2 }), {
    kind: "wait",
    reasons: [{ machineId: "local", code: "capacity" }],
  });
  assert.deepEqual(selectPlacement(policy, { mode: "preferred", machineId: "b" }, eligible, { a: 4, b: 2, local: 2 }), {
    kind: "wait",
    reasons: ["b", "a", "local"].map((machineId) => ({ machineId, code: "capacity" })),
  });
  policy.order = [];
  assert.deepEqual(selectPlacement(policy, undefined, eligible, {}), {
    kind: "wait",
    reasons: [{ code: "no-candidates" }],
  });
  for (const mode of ["required", "preferred"] as const)
    assert.deepEqual(selectPlacement(policy, { mode, machineId: "a" }, eligible, {}), {
      kind: "selected",
      machineId: "a",
    });
});

test("eligibility priority precedes capacity; missing evidence never implies eligibility", () => {
  const policy = normalizePlacementPolicy({ scheduling: scheduling(), maxConcurrentWorkers: 3 });
  for (const [index, code] of ELIGIBILITY_REASONS.entries()) {
    assert.deepEqual(
      selectPlacement(
        policy,
        { mode: "required", machineId: "a" },
        { a: { failures: [...ELIGIBILITY_REASONS.slice(index)].reverse() } },
        { a: 99 },
      ),
      { kind: "wait", reasons: [{ machineId: "a", code }] },
    );
  }
  assert.deepEqual(selectPlacement(policy, { mode: "required", machineId: "gone" }, eligible, {}), {
    kind: "wait",
    reasons: [{ machineId: "gone", code: "missing-target" }],
  });
  policy.machines.a!.enabled = false;
  assert.deepEqual(selectPlacement(policy, { mode: "required", machineId: "a" }, {}, {}), {
    kind: "wait",
    reasons: [{ machineId: "a", code: "disabled" }],
  });
  for (const machineId of ["b", "local"]) {
    const result = selectPlacement(
      policy,
      machineId === "local" ? { mode: "local-only" } : { mode: "required", machineId },
      {},
      {},
    );
    assert.equal(result.kind, "wait");
    if (result.kind === "wait") {
      assert.equal(result.reasons[0]?.code, "incompatible");
      assert.match(result.reasons[0]?.detail ?? "", /unverified/);
    }
  }
  assert.deepEqual(selectPlacement(policy, undefined, eligible, {}), { kind: "selected", machineId: "b" });
});

test("zero and reduced caps wait; invalid supplied usage is rejected", () => {
  const policy = normalizePlacementPolicy({ maxConcurrentWorkers: 0 });
  for (const used of [0, 1, 20])
    assert.deepEqual(selectPlacement(policy, undefined, eligible, { local: used }), {
      kind: "wait",
      reasons: [{ machineId: "local", code: "capacity" }],
    });
  for (const used of [-1, 0.5, Infinity, NaN, Number.MAX_SAFE_INTEGER + 1, "1"])
    assert.throws(() => selectPlacement(policy, undefined, eligible, { unused: used } as never), /usage.unused/);
});

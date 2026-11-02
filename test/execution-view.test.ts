import assert from "node:assert/strict";
import { test } from "node:test";
import { machineUsage } from "../src/model/placement.ts";
import { capacityText, machineName, occupancy, recoveryBlocked, shownExecutions } from "../src/web/lib/execution.ts";

const entry = (id: string, occupying: boolean) => ({ id, occupying });

test("shownExecutions hides terminal history unless asked and keeps the server's order", () => {
  const ledger = [entry("b", true), entry("a", true), entry("z", false), entry("y", false)];
  assert.deepEqual(
    shownExecutions(ledger, false).map((e) => e.id),
    ["b", "a"],
  );
  assert.deepEqual(
    shownExecutions(ledger, true).map((e) => e.id),
    ["b", "a", "z", "y"],
  );
});

test("occupancy marks any occupying entry without a live Claim as unconfirmed", () => {
  assert.equal(occupancy({ status: "running", occupying: true, claimLive: true }), "active");
  assert.equal(occupancy({ status: "launching", occupying: true, claimLive: true }), "pending");
  assert.equal(occupancy({ status: "running", occupying: true, claimLive: false }), "unconfirmed");
  assert.equal(occupancy({ status: "launching", occupying: true, claimLive: false }), "unconfirmed");
  assert.equal(occupancy({ status: "unknown", occupying: true, claimLive: true }), "unknown");
  assert.equal(occupancy({ status: "unknown", occupying: true, claimLive: false }), "unknown");
  assert.equal(occupancy({ status: "terminal", occupying: false, claimLive: false }), "ended");
});

test("recoveryBlocked allows requests only for delivered, occupying executions", () => {
  assert.equal(recoveryBlocked({ status: "running", occupying: true }), undefined);
  assert.equal(recoveryBlocked({ status: "unknown", occupying: true }), undefined);
  assert.match(recoveryBlocked({ status: "reserved", occupying: true }) ?? "", /not been delivered/);
  assert.match(recoveryBlocked({ status: "terminal", occupying: false }) ?? "", /ended/);
});

test("usage heads count only occupying entries and show unknown capacity as unknown", () => {
  const config = {
    maxConcurrentWorkers: 3,
    remoteMachines: [{ id: "gpu", name: "GPU box", enabled: false, capacity: 2 }],
    scheduling: { local: { capacity: 1 }, order: ["local", "gpu"] },
  };
  const usage = machineUsage(config, [
    { machineId: "local", status: "running" },
    { machineId: "local", status: "unknown" },
    { machineId: "local", status: "terminal" },
    { machineId: "gone", status: "running" },
  ]);
  assert.deepEqual(
    usage.map((m) => [m.id, m.used, capacityText(m.capacity), m.enabled, m.configured]),
    [
      ["local", 2, "1", true, true],
      ["gpu", 0, "2", false, true],
      ["gone", 1, "unknown", false, false],
    ],
  );
  assert.equal(machineName(config, "gpu"), "GPU box (gpu)");
  assert.equal(machineName(config, "gone"), "gone");
  assert.deepEqual(
    machineUsage({ maxConcurrentWorkers: 4 }, []).map((m) => [m.id, capacityText(m.capacity)]),
    [["local", "4"]],
  );
});

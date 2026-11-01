import type { RemoteMachine, SchedulingConfig } from "#model/config";

/** Two enabled remotes with explicit capacities. */
export function remoteMachines(): RemoteMachine[] {
  return ["a", "b"].map((id, index) => ({ id, name: id.toUpperCase(), enabled: true, capacity: index ? 2 : 4 }));
}

export function scheduling(): SchedulingConfig {
  return { local: { capacity: 2 }, order: ["a", "b", "local"] };
}

/** The catalog and the scheduling that orders it, as Project config. */
export function machines() {
  return { remoteMachines: remoteMachines(), scheduling: scheduling() };
}

/** The pre-DEV-31 shape: remotes embedded in scheduling with harness mapping fields. */
export function legacyScheduling() {
  return {
    local: { capacity: 2 },
    remotes: remoteMachines().map((r) => ({
      ...r,
      environmentId: `env-${r.id}`,
      project: { projectId: `project-${r.id}`, repository: "github.com/sgolovine/sf" },
    })),
    order: ["a", "b", "local"],
  };
}

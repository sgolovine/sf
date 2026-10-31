import type { SchedulingConfig } from "#model/config";
export function scheduling(): SchedulingConfig {
  return {
    local: { capacity: 2 },
    remotes: ["a", "b"].map((id, index) => ({
      id,
      name: id.toUpperCase(),
      environmentId: `env-${id}`,
      project: { projectId: `project-${id}`, repository: "github.com/sgolovine/sf" },
      enabled: true,
      capacity: index ? 2 : 4,
    })),
    order: ["a", "b", "local"],
  };
}

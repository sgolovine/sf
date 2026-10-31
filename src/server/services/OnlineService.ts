import { supportFor } from "#model/execution";
import { createService, type Service, type ServiceOptions } from "../project/service.ts";
import { type Store, StoreService } from "./StoreService.ts";

/**
 * The online Story service: spawns and execution lookups become commands in the
 * Store (the Supervisor boundary), and every change refreshes the Project
 * snapshot the UI sees. sf schedules reconciliation on every mutation, so
 * startup, reconnect, results and the periodic sweep all issue due lookups.
 */
function create(store: Store, options: Pick<ServiceOptions, "root" | "sf" | "git" | "now">) {
  const service = createService({
    ...options,
    online: true,
    execution: {
      support: () => supportFor(store.state.supervisor.capabilities),
      publish: (command, key) => StoreService.enqueue(store, command, key).id,
      commandState: (id) => StoreService.commandStatus(store, id),
    },
    spawnMode: () => (store.state.supervisor.capabilities?.canSpawnThreads ? "thread" : "subagent"),
    onChange: () => refreshProject(store, service),
  });
  refreshProject(store, service);
  return service;
}

function refreshProject(store: Store, service: Service) {
  try {
    StoreService.setProject(store, service.snapshot());
  } catch (err) {
    // A hand edit can leave a file unreadable; keep the last good snapshot.
    console.error(`sf: cannot read the Project: ${(err as Error).message}`);
  }
}

export const OnlineService = {
  create,
  refreshProject,
};

import { createService, type Service, type ServiceOptions } from "../project/service.ts";
import { StoreService, type Store } from "./StoreService.ts";

/**
 * The online Story service: spawns become `worker.spawn` commands in the Store,
 * and every change refreshes the Project snapshot the UI sees.
 */
function create(store: Store, options: Pick<ServiceOptions, "root" | "sf" | "git" | "now">) {
  const service = createService({
    ...options,
    online: true,
    onSpawn: (request) => StoreService.enqueue(store, { type: "worker.spawn", ...request }).id,
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

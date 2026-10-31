/** The Story dialog addressed by the URL path: `/` none, `/create` a new Story, `/<KEY>` an existing one. */
export type StoryRoute = { kind: "none" } | { kind: "create" } | { kind: "edit"; key: string };

export const NO_STORY: StoryRoute = { kind: "none" };

/** Reads a path; paths that are neither `/create` nor shaped like a Story Key mean no dialog. */
export function parseStoryPath(pathname: string): StoryRoute {
  if (pathname === "/create") return { kind: "create" };
  const key = pathname.slice(1);
  // A fresh object, so a popstate to another unrecognized path still re-renders and gets replaced.
  return /^[A-Z][A-Z0-9]*-\d+$/.test(key) ? { kind: "edit", key } : { kind: "none" };
}

export function storyPath(route: StoryRoute): string {
  return route.kind === "create" ? "/create" : route.kind === "edit" ? `/${route.key}` : "/";
}

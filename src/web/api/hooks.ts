import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { CommandRecord } from "#model/commands";
import { sfApi } from "./client.ts";

export const sessionKey = ["sf", "session"] as const;

/**
 * Live session state. The initial fetch goes through TanStack Query; the
 * server-sent event stream then writes every update straight into the cache.
 */
export function useSession() {
  const queryClient = useQueryClient();
  useEffect(
    () => sfApi.subscribe((state) => queryClient.setQueryData(sessionKey, state)),
    [queryClient],
  );
  return useQuery({ queryKey: sessionKey, queryFn: sfApi.getState, staleTime: Infinity });
}

/** Returns one command's live record. */
export function useCommand(id: string | undefined): CommandRecord | undefined {
  const { data } = useSession();
  return id ? data?.commands.find((c) => c.id === id) : undefined;
}

/**
 * Wraps any sfApi call as a mutation. The server pushes the resulting state
 * over SSE, so there is nothing to write into the cache here.
 */
export function useSfMutation<V, R>(fn: (vars: V) => Promise<R>) {
  return useMutation({ mutationFn: fn });
}

/** `instruct.mutate("...")` → a free-form instruction for the Supervisor. */
export const useInstruct = () => useSfMutation((text: string) => sfApi.instruct(text));

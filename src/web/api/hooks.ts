import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import type { CommandRecord } from "#model/commands";
import type { ExecutionAttempt } from "#model/runtime";
import { sfApi } from "./client.ts";

export const sessionKey = ["sf", "session"] as const;

/**
 * Live session state. The initial fetch goes through TanStack Query; the
 * server-sent event stream then writes every update straight into the cache.
 */
export function useSession() {
  const queryClient = useQueryClient();
  useEffect(() => sfApi.subscribe((state) => queryClient.setQueryData(sessionKey, state)), [queryClient]);
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

/** Stories matching `q`, keyed by the query so a stale response never replaces a newer one. */
export function useSearch(q: string) {
  const query = q.trim();
  return useQuery({
    queryKey: ["sf", "search", query],
    queryFn: () => sfApi.search(query),
    enabled: query !== "",
    placeholderData: keepPreviousData,
  });
}

export const executionsKey = ["sf", "executions"] as const;

/**
 * The Project's execution ledger while a view shows it. It refetches on every session update
 * (runtime changes arrive over SSE) and polls every 5 s while the page is visible as a fallback.
 */
export function useExecutions() {
  const queryClient = useQueryClient();
  const { dataUpdatedAt } = useSession();
  useEffect(() => {
    // Each SSE update stamps a new dataUpdatedAt on the session query.
    if (dataUpdatedAt) void queryClient.invalidateQueries({ queryKey: executionsKey });
  }, [queryClient, dataUpdatedAt]);
  return useQuery({ queryKey: executionsKey, queryFn: sfApi.listExecutions, refetchInterval: 5000 });
}

/** A reconcile or cancel request; the ledger is refetched afterwards rather than edited optimistically. */
export function useExecutionRequest(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (kind: ExecutionAttempt["kind"]) =>
      kind === "reconcile" ? sfApi.reconcileExecution(id) : sfApi.cancelExecution(id),
    // Not awaited: the request's own result should not wait for the list to reload.
    onSettled: () => void queryClient.invalidateQueries({ queryKey: executionsKey }),
  });
}

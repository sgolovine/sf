import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { CommandRecord, HostCommand, SessionState, SpawnSubagentCommand, SpawnThreadCommand } from "@sf/protocol";
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

/** Returns one command's live record, e.g. to show the result of a spawn. */
export function useCommand(id: string | undefined): CommandRecord | undefined {
  const { data } = useSession();
  return id ? data?.commands.find((c) => c.id === id) : undefined;
}

function useCommandMutation<V>(toCommand: (vars: V) => Promise<CommandRecord>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: toCommand,
    onSuccess: (record) =>
      queryClient.setQueryData<SessionState>(sessionKey, (state) =>
        state && !state.commands.some((c) => c.id === record.id)
          ? { ...state, commands: [...state.commands, record] }
          : state,
      ),
  });
}

/** Send any HostCommand to the host thread. */
export const useSendCommand = () => useCommandMutation((command: HostCommand) => sfApi.send(command));

/** `spawnThread.mutate({ prompt: "..." })` → the host starts a new thread with that prompt. */
export const useSpawnThread = () =>
  useCommandMutation(({ prompt, ...opts }: Omit<SpawnThreadCommand, "type">) =>
    sfApi.spawnThread(prompt, opts),
  );

/** `spawnSubagent.mutate({ prompt: "..." })` → the host runs the prompt in a child agent. */
export const useSpawnSubagent = () =>
  useCommandMutation(({ prompt, ...opts }: Omit<SpawnSubagentCommand, "type">) =>
    sfApi.spawnSubagent(prompt, opts),
  );

/** `instruct.mutate("...")` → a free-form instruction for the host thread. */
export const useInstruct = () => useCommandMutation((text: string) => sfApi.instruct(text));

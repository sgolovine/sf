import { CircleAlert } from "lucide-react";
import { type ReactNode, useId, useState } from "react";
import type { ExecutionView } from "#model/api";
import type { ProjectConfig } from "#model/config";
import { machineUsage } from "#model/placement";
import type { BoardSnapshot } from "#model/project";
import type { ExecutionAttempt } from "#model/runtime";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { useExecutionRequest, useExecutions } from "../api/hooks.ts";
import {
  capacityText,
  machineName,
  OCCUPANCY_LABEL,
  type Occupancy,
  occupancy,
  recoveryBlocked,
  shownExecutions,
} from "../lib/execution.ts";
import type { Act } from "./ErrorBanner.tsx";

const OCCUPANCY_STYLE: Record<Occupancy, string> = {
  active: "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  pending: "border-sky-500/40 bg-sky-500/10 text-sky-700 dark:text-sky-300",
  unconfirmed: "border-amber-500/50 bg-amber-500/15 text-amber-800 dark:text-amber-300",
  unknown: "border-orange-500/60 bg-orange-500/15 text-orange-800 dark:text-orange-300",
  ended: "border-border bg-muted text-muted-foreground",
};

/** The Project-wide execution ledger: what occupies Worker capacity and why, with recovery requests. */
export function ExecutionsView({
  project,
  boards,
  act,
}: {
  project: ProjectConfig;
  boards: BoardSnapshot[];
  act: Act;
}) {
  const id = useId();
  const [showTerminal, setShowTerminal] = useState(false);
  const { data, error, refetch, isFetching } = useExecutions();
  // Usage comes from the ledger entries, never from Claims; terminal history never counts.
  const machines = data ? machineUsage(project, data.executions) : [];
  const shown = data ? shownExecutions(data.executions, showTerminal) : [];

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-5 p-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h2 className="text-lg font-semibold">Executions</h2>
        <div className="flex items-center gap-2">
          <Switch id={`${id}-terminal`} checked={showTerminal} onCheckedChange={setShowTerminal} />
          <Label htmlFor={`${id}-terminal`}>Show ended executions</Label>
        </div>
      </div>
      <p className="text-sm text-muted-foreground">
        Every Board in this Project. An execution occupies a Worker slot until correlated evidence confirms it ended; a
        Claim ending is not that evidence. The machine is the one sf requested; the harness decides where the Worker
        actually runs.
      </p>

      {data && (
        <section aria-label="Machine usage" className="flex flex-wrap gap-2">
          {machines.map((m) => (
            <div
              key={m.id}
              className={cn(
                "rounded-md border px-3 py-1.5 text-sm",
                m.capacity !== null && m.used > m.capacity && "border-amber-500/60",
              )}
            >
              <span className="font-medium break-all">{machineName(project, m.id)}</span>{" "}
              <span className="tabular-nums">
                {m.used}/{capacityText(m.capacity)}
              </span>
              {!m.configured && <span className="text-muted-foreground"> · not configured</span>}
              {m.configured && !m.enabled && <span className="text-muted-foreground"> · disabled</span>}
              {m.capacity !== null && m.used > m.capacity && (
                <span className="text-amber-700 dark:text-amber-300"> · over capacity</span>
              )}
            </div>
          ))}
        </section>
      )}

      {error && (
        <Alert variant="destructive">
          <CircleAlert />
          <AlertDescription className="flex flex-wrap items-center gap-2">
            Could not load executions: {error.message}
            <Button size="xs" variant="outline" disabled={isFetching} onClick={() => void refetch()}>
              Retry
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {!data ? (
        !error && <p className="text-sm text-muted-foreground">Loading executions…</p>
      ) : shown.length === 0 ? (
        <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
          {showTerminal ? "No executions recorded." : "Nothing occupies a Worker slot."}
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {shown.map((e) => (
            <ExecutionRow key={e.id} execution={e} project={project} boards={boards} act={act} />
          ))}
        </ul>
      )}
    </div>
  );
}

function ExecutionRow({
  execution: e,
  project,
  boards,
  act,
}: {
  execution: ExecutionView;
  project: ProjectConfig;
  boards: BoardSnapshot[];
  act: Act;
}) {
  const request = useExecutionRequest(e.id);
  const [sent, setSent] = useState<{ kind: ExecutionAttempt["kind"]; view: ExecutionView }>();
  const state = occupancy(e);
  const blocked = recoveryBlocked(e);
  const board = boards.find((b) => b.id === e.board);
  const stage = board?.config.stages.find((s) => s.id === e.stageId);
  const send = (kind: ExecutionAttempt["kind"]) =>
    void act(async () => setSent({ kind, view: await request.mutateAsync(kind) }));

  return (
    <li
      className={cn(
        "flex flex-col gap-3 rounded-md border p-4",
        (state === "unconfirmed" || state === "unknown") && "border-l-4 border-l-amber-500",
        state === "ended" && "opacity-80",
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono font-medium">{e.storyKey}</span>
        <span className="text-sm text-muted-foreground">
          {board?.config.name ?? e.board} · {stage?.name ?? e.stageId}
        </span>
        <span className="flex-1" />
        <span className={cn("rounded-full border px-2 py-0.5 text-xs font-medium", OCCUPANCY_STYLE[state])}>
          {OCCUPANCY_LABEL[state]}
        </span>
      </div>

      <dl className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-[max-content_1fr]">
        <Field label="Execution">
          <span className="font-mono">{e.id}</span>
        </Field>
        <Field label="Requested machine">{machineName(project, e.machineId)}</Field>
        <Field label="Status">
          {e.status}
          {e.outcome && ` · ${e.outcome}`}
          {e.occupying ? " · occupying a slot" : " · not occupying"}
        </Field>
        <Field label="Claim">{e.claimLive ? "active" : "ended"}</Field>
        <Field label="Waiting for">{e.waitingFor}</Field>
        {(e.taskId || e.threadId || e.label) && (
          <Field label="Supervisor reported">
            {[e.taskId && `task ${e.taskId}`, e.threadId && `thread ${e.threadId}`, e.label && `label ${e.label}`]
              .filter(Boolean)
              .join(" · ")}
          </Field>
        )}
        {e.evidence && <Field label="Evidence">{e.evidence}</Field>}
        {e.conflict && <Field label="Conflict">{e.conflict}</Field>}
        {e.recovery && <Field label="Recovery needed">{e.recovery}</Field>}
        {e.attempt && (
          <Field label="Outstanding request">
            {e.attempt.kind} <span className="font-mono">{e.attempt.id}</span>
          </Field>
        )}
      </dl>

      {e.occupying && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <Button
            size="sm"
            variant="outline"
            disabled={!!blocked || request.isPending}
            onClick={() => send("reconcile")}
          >
            Reconcile
          </Button>
          <Button size="sm" variant="outline" disabled={!!blocked || request.isPending} onClick={() => send("cancel")}>
            Request cancel
          </Button>
          <span role="status" className="min-w-0 text-muted-foreground">
            {blocked
              ? blocked
              : request.isPending
                ? `Sending ${request.variables} request…`
                : sent &&
                  `${sent.kind === "cancel" ? "Cancel" : "Reconcile"} request sent to the Supervisor` +
                    `${sent.view.attempt ? ` (${sent.view.attempt.kind} ${sent.view.attempt.id})` : ""}` +
                    `; waiting for: ${sent.view.waitingFor}`}
          </span>
        </div>
      )}
    </li>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words [overflow-wrap:anywhere]">{children}</dd>
    </>
  );
}

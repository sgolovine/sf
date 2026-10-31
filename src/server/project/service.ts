// The one library every Story change goes through: HTTP routes (UI, Supervisor,
// Workers) when the server is up, and the CLI directly when it is not.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { ExecutionsResponse, ExecutionView, StoryDetails, UpdateProjectRequest } from "#model/api";
import type { AttachmentInput, AttachmentSubmission } from "#model/attachment";
import type { CommandStatus, ExecutionReconcileCommand, SupervisorCommand, WorkerSpawnCommand } from "#model/commands";
import { activeHil, type BoardConfig, type BoardOverrides, type FieldDef, type ProjectConfig } from "#model/config";
import { type AdapterSupport, type ExecutionReport, supportFor } from "#model/execution";
import { modelCatalog, resolveModel } from "#model/models";
import {
  normalizePlacementPolicy,
  type StoryPlacement,
  selectPlacement,
  type TargetEligibility,
  validatePlacement,
} from "#model/placement";
import type { ProjectSnapshot, StoryView } from "#model/project";
import {
  type Execution,
  type ExecutionAttempt,
  type ExecutionOutcome,
  occupies,
  type QueueEntry,
  type QueueWait,
  type RuntimeState,
  type WorkerEndReason,
} from "#model/runtime";
import { attachmentStore } from "./attachments.ts";
import { composeBrief, machineRequest } from "./brief.ts";
import {
  BACKLOG,
  DEFAULT_PROJECT_CONFIG,
  DONE,
  defaultBoard,
  isFixedStage,
  listBoardIds,
  loadBoard,
  loadProjectConfig,
  normalizeModelOptions,
  resolveSettings,
  saveBoard,
  slug,
  uniqueId,
  validateBoard,
  validateModel,
  validateSchema,
} from "./config.ts";
import { SfError } from "./errors.ts";
import { atomicWrite, withLock, writeJson } from "./fsutil.ts";
import { sfPaths } from "./paths.ts";
import { loadRuntime, saveRuntime } from "./runtime.ts";
import { readStage, serializeStage } from "./stage.ts";
import {
  dependencyKeys,
  nextStoryNumber,
  parseStory,
  parseStoryKey,
  type StoryData,
  serializeStory,
  validateBuiltinFields,
  validateFields,
} from "./story.ts";
import {
  type CleanupResult,
  cleanupWorktree,
  ensureWorktree,
  type Git,
  resolveBaseBranch,
  runGit,
  storyBranch,
  worktreePath,
} from "./worktree.ts";

export type Actor = { kind: "user" } | { kind: "supervisor" } | { kind: "worker"; id: string };

/** A `worker.spawn` as published; `execution` is its durable launch identity. */
export type SpawnRequest = Omit<WorkerSpawnCommand, "type">;

/**
 * The Supervisor side of execution. sf decides placement, capacity and Claims;
 * the boundary delivers commands and reports what its tools can establish.
 * Every call is local and fast: none may reach a machine over the network.
 */
export type ExecutionBoundary = {
  support(): AdapterSupport;
  /** Explicit evidence per machine; when omitted, derived from `support()`. */
  eligibility?(machineIds: string[], request: { agent?: string; model?: string }): Record<string, TargetEligibility>;
  /** Publishes a command, deduplicated by `key`. Returns its id. Throws when it cannot be persisted. */
  publish(command: SupervisorCommand, key: string): string;
  /** Where a published command is; undefined when unknown. */
  commandState?(id: string): CommandStatus | undefined;
};

const ATTEMPT_BACKOFF_MS = 60_000;
const MAX_BACKOFF_MS = 30 * 60_000;
const ATTEMPT_TIMEOUT_MS = 10 * 60_000;
const MAX_OUTSTANDING_ATTEMPTS = 4;
/** Terminal executions kept as history; occupying ones are never trimmed. */
const MAX_ENDED_EXECUTIONS = 500;

export type ServiceOptions = {
  root: string;
  /** True inside the server. Offline, spawns and cleanups become pending triggers. */
  online: boolean;
  now?: () => number;
  git?: Git;
  /** Online: queues a `worker.spawn` command and returns its id. Used when `execution` is not given. */
  onSpawn?: (request: SpawnRequest) => string;
  /** The execution adapter boundary; defaults to a local one that publishes through `onSpawn`. */
  execution?: ExecutionBoundary;
  /** How new Workers run, from the Supervisor's capabilities. */
  spawnMode?: () => "thread" | "subagent";
  /** Shell-ready sf command for Worker Briefs. */
  sf?: string;
  /** Called after every mutation. */
  onChange?: () => void;
};

export type StoryInput = AttachmentSubmission & {
  placement?: StoryPlacement | null;
  dependsOn?: string[];
  model?: string | null;
  title: string;
  stage?: string;
  fields?: Record<string, unknown>;
  body?: string;
};
export type StoryPatch = AttachmentSubmission & {
  placement?: StoryPlacement | null;
  dependsOn?: string[];
  model?: string | null;
  title?: string;
  fields?: Record<string, unknown>;
  body?: string;
};
export type StagePatch = {
  name?: string;
  promptEnabled?: boolean;
  prompt?: string;
  agent?: string | null;
  model?: string | null;
  /** HIL flag field id; empty or null clears the Stage's HIL. */
  hilFlag?: string | null;
  /** HIL comment field id; empty or null clears it. */
  hilComment?: string | null;
};
export type BoardPatch = {
  addModelOptions?: import("#model/models").ModelOption[];
  modelOptions?: import("#model/models").ModelOption[];
  model?: string | null;
  name?: string;
  schema?: FieldDef[];
  overrides?: BoardOverrides;
};

type Tx = { rt: RuntimeState; project: ProjectConfig; after: (() => Promise<unknown>)[] };

export type Service = ReturnType<typeof createService>;

export function createService(opts: ServiceOptions) {
  const { root, online } = opts;
  const now = opts.now ?? Date.now;
  const git = opts.git ?? runGit;
  const paths = sfPaths(root);
  let localIds = 0;
  const boundary: ExecutionBoundary = opts.execution ?? {
    support: () => supportFor(null),
    publish: (command) =>
      (command.type === "worker.spawn" ? opts.onSpawn?.(command) : undefined) ?? `local-${++localIds}`,
  };

  // ---------- reads ----------

  function boardRef(ref: string): { id: string; config: BoardConfig } {
    const ids = listBoardIds(root);
    if (ids.includes(ref)) return { id: ref, config: loadBoard(root, ref) };
    for (const id of ids) {
      const config = loadBoard(root, id);
      if (config.key === ref.toUpperCase()) return { id, config };
    }
    throw new SfError("not_found", `no Board "${ref}"`);
  }

  function storyFile(boardId: string, key: string) {
    return path.join(paths.stories(boardId), `${key}.md`);
  }

  function locate(key: string) {
    const parsed = parseStoryKey(key);
    if (!parsed) throw new SfError("invalid", `"${key}" is not a Story Key (expected e.g. DEV-1)`);
    for (const id of listBoardIds(root)) {
      const board = loadBoard(root, id);
      if (board.key !== parsed.boardKey) continue;
      const file = storyFile(id, key);
      if (!fs.existsSync(file)) break;
      return {
        boardId: id,
        board,
        story: parseStory(
          fs.readFileSync(file, "utf8"),
          board.schema.some((f) => f.id === "model"),
        ),
      };
    }
    throw new SfError("not_found", `no Story ${key}`);
  }

  function tryLocate(key: string) {
    try {
      return locate(key);
    } catch {
      return null;
    }
  }

  function writeStory(boardId: string, key: string, story: StoryData) {
    atomicWrite(storyFile(boardId, key), serializeStory(story));
  }

  function promptText(boardId: string, stageId: string) {
    try {
      return readStage(path.join(paths.stages(boardId), `${stageId}.md`)).body;
    } catch {
      return "";
    }
  }

  function instructionText(file: string) {
    try {
      return fs.readFileSync(file, "utf8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return "";
      throw new SfError("invalid", `cannot read Worker instructions at ${file}: ${String(err)}`);
    }
  }

  /** True when entering this Stage spawns a Worker: enabled, not fixed, and a non-blank prompt. */
  function stageSpawns(boardId: string, board: BoardConfig, stageId: string) {
    const stage = board.stages.find((s) => s.id === stageId);
    return Boolean(stage?.promptEnabled && !isFixedStage(stageId) && promptText(boardId, stageId).trim());
  }

  /** True when entering this Stage spawns a Worker for this Story: the Stage spawns and the Story is not held for HIL. */
  function spawnsFor(boardId: string, board: BoardConfig, stageId: string, story: StoryData) {
    return (
      stageSpawns(boardId, board, stageId) &&
      !activeHil(board, { ...story, stage: stageId }) &&
      !unresolved(story).length
    );
  }

  function unresolved(story: Pick<StoryData, "dependsOn">): string[] {
    return (story.dependsOn ?? []).filter((key) => tryLocate(key)?.story.stage !== DONE);
  }

  function allStories() {
    return listBoardIds(root).flatMap(storyViews);
  }

  function validateDependencies(key: string, value: unknown) {
    const keys = dependencyKeys(value);
    const visited = new Set<string>();
    const visit = (current: string, chain: string[]) => {
      if (current === key) throw new SfError("invalid", `dependency cycle: ${[key, ...chain, key].join(" → ")}`);
      if (chain.includes(current))
        throw new SfError("invalid", `existing dependency cycle: ${[...chain, current].join(" → ")}`);
      if (visited.has(current)) return;
      const found = tryLocate(current);
      if (!found)
        throw new SfError("invalid", `dependency ${current} does not exist; create it or remove it from dependsOn`);
      for (const next of found.story.dependsOn ?? []) visit(next, [...chain, current]);
      visited.add(current);
    };
    for (const dep of keys) visit(dep, []);
    return keys;
  }

  /** Reconcile durable waits, without restarting released or already running Workers. */
  function reconcileDependencies(tx: Tx) {
    for (const story of allStories()) {
      if (!tx.rt.claims[story.key] && unresolved(story).length) {
        tx.rt.dependencyWaits[story.key] = { stageId: story.stage };
        dropSpawn(tx, story.key);
      }
    }
    for (const [key, wait] of Object.entries(tx.rt.dependencyWaits)) {
      const found = tryLocate(key);
      if (!found || found.story.stage !== wait.stageId) {
        delete tx.rt.dependencyWaits[key];
        continue;
      }
      if (!tx.rt.claims[key] && spawnsFor(found.boardId, found.board, wait.stageId, found.story))
        requestSpawn(tx, key, found.boardId, wait.stageId);
    }
  }

  function view(key: string, boardId: string, story: StoryData): StoryView {
    return {
      key,
      board: boardId,
      title: story.title,
      stage: story.stage,
      ...(story.branch ? { branch: story.branch } : {}),
      ...(story.model ? { model: story.model } : {}),
      ...(story.placement ? { placement: story.placement } : {}),
      dependsOn: story.dependsOn ?? [],
      unresolvedDependencies: unresolved(story),
      waitingOnDependencies: unresolved(story).length > 0,
      fields: story.fields,
      body: story.body,
    };
  }

  function details(rt: RuntimeState, v: StoryView): StoryDetails {
    const board = loadBoard(root, v.board);
    const project = loadProjectConfig(root);
    const d: StoryDetails = {
      ...v,
      effectiveModel: resolveModel(
        project,
        board,
        board.stages.find((s) => s.id === v.stage),
        v,
      ),
      modelOptions: modelCatalog(project, board, [v.model]),
    };
    if (rt.claims[v.key]) d.claim = rt.claims[v.key];
    const entry = rt.queue.find((q) => q.storyKey === v.key);
    if (entry) d.queued = true;
    if (entry?.wait) d.wait = entry.wait;
    const busy = occupant(rt, v.key);
    if (busy) d.execution = executionView(rt, busy);
    if (rt.failures[v.key]) d.failure = rt.failures[v.key];
    if (rt.worktreeWarnings[v.key]) d.worktreeWarning = rt.worktreeWarnings[v.key];
    const hil = board && activeHil(board, v);
    if (hil) d.hil = hil;
    return d;
  }

  function storyViews(boardId: string): StoryView[] {
    const dir = paths.stories(boardId);
    if (!fs.existsSync(dir)) return [];
    return fs
      .readdirSync(dir)
      .filter((f) => f.endsWith(".md") && parseStoryKey(f.slice(0, -3)))
      .map((f) => {
        const key = f.slice(0, -3);
        try {
          return view(
            key,
            boardId,
            parseStory(
              fs.readFileSync(path.join(dir, f), "utf8"),
              loadBoard(root, boardId).schema.some((f) => f.id === "model"),
            ),
          );
        } catch (err) {
          return view(key, boardId, {
            title: `(unreadable: ${(err as Error).message})`,
            stage: "",
            fields: {},
            body: "",
          });
        }
      })
      .sort((a, b) => parseStoryKey(a.key)!.number - parseStoryKey(b.key)!.number);
  }

  // ---------- runtime transitions (always inside mutate) ----------

  async function mutate<T>(fn: (tx: Tx) => T, drain = true, published = new Set<string>()): Promise<T> {
    loadProjectConfig(root);
    const after: Tx["after"] = [];
    let result: T;
    let outbox: Publication[] = [];
    try {
      result = await withLock(root, () => {
        const tx: Tx = { rt: loadRuntime(root), project: loadProjectConfig(root), after };
        try {
          sweep(tx);
          if (drain) drainQueue(tx);
          const result = fn(tx);
          reconcileDependencies(tx);
          // Placement, configuration and Claim changes made by `fn` wake the queue too.
          if (drain) drainQueue(tx);
          scheduleAttempts(tx);
          return result;
        } finally {
          saveRuntime(root, tx.rt);
          outbox = publications(tx.rt).filter((p) => !published.has(p.key));
        }
      });
    } catch (err) {
      // The runtime was saved anyway: publish what it reserved before reporting the error.
      opts.onChange?.();
      if (outbox.length) await publish(outbox, published);
      throw err;
    }
    opts.onChange?.();
    // Commands leave the outbox only after their reservation is saved, and never under the lock.
    if (outbox.length) await publish(outbox, published);
    for (const task of after) await task();
    return result;
  }

  type Publication = { executionId: string; attemptId?: string; command: SupervisorCommand; key: string };

  /** Saved intents not yet acknowledged by the boundary: undelivered launches and new attempts. */
  function publications(rt: RuntimeState): Publication[] {
    if (!online) return [];
    const list: Publication[] = [];
    for (const e of Object.values(rt.executions)) {
      if (e.status === "reserved" && e.intent && !e.commandId)
        list.push({ executionId: e.id, command: e.intent, key: `spawn:${e.id}` });
      if (e.attempt && !e.attempt.commandId)
        list.push({
          executionId: e.id,
          attemptId: e.attempt.id,
          command: attemptCommand(e, e.attempt),
          key: `${e.attempt.kind}:${e.attempt.id}`,
        });
    }
    return list;
  }

  async function publish(list: Publication[], published: Set<string>) {
    // Publication is deduplicated by key; a failure leaves the intent for the next mutation.
    const ids = list.map((p) => boundary.publish(p.command, p.key));
    for (const p of list) published.add(p.key);
    await mutate(
      ({ rt }) => {
        list.forEach((p, i) => {
          const e = rt.executions[p.executionId];
          const id = ids[i];
          if (!e || !id) return;
          if (p.attemptId) {
            if (e.attempt?.id === p.attemptId) e.attempt.commandId = id;
            return;
          }
          if (e.status !== "reserved" || e.commandId) return;
          e.commandId = id;
          const claim = rt.claims[e.storyKey];
          if (claim?.executionId === e.id) claim.commandId = id;
        });
      },
      false,
      published,
    );
  }

  function attemptCommand(e: Execution, attempt: ExecutionAttempt): SupervisorCommand {
    return {
      type: attempt.kind === "cancel" ? "execution.cancel" : "execution.reconcile",
      execution: executionRef(e),
      attemptId: attempt.id,
      workerId: e.workerId,
      storyKey: e.storyKey,
      mode: e.mode,
      worktree: e.worktree,
      ...(e.taskId ? { taskId: e.taskId } : {}),
      ...(e.threadId ? { threadId: e.threadId } : {}),
      ...(e.label ? { label: e.label } : {}),
    };
  }

  function executionRef(e: Execution) {
    return { id: e.id, machineId: e.machineId, environmentId: e.environmentId, projectId: e.projectId };
  }

  /** The execution occupying the Story's branch, if any. */
  function occupant(rt: RuntimeState, key: string): Execution | undefined {
    return Object.values(rt.executions).find((e) => e.storyKey === key && occupies(e));
  }

  /** Rejects work on the Story branch while an execution other than `owner` occupies it. */
  function fence(rt: RuntimeState, key: string, owner?: string) {
    const busy = occupant(rt, key);
    if (busy && busy.id !== owner)
      throw new SfError(
        "claimed",
        `${key}'s Story branch is occupied by execution ${busy.id} (${busy.status}); wait for it to end or reconcile it with \`sf execution\``,
      );
  }

  /** Why a reservation no longer matches its request, checked again after asynchronous preparation. */
  function staleSelection(tx: Tx, e: Execution, found: NonNullable<ReturnType<typeof tryLocate>>): string | null {
    const stage = found.board.stages.find((s) => s.id === e.stageId);
    const settings = resolveSettings(tx.project, found.board, stage, found.story);
    if ((settings.agent ?? undefined) !== e.agent || (settings.model ?? undefined) !== e.model)
      return "the resolved agent or model changed";
    const policy = normalizePlacementPolicy(tx.project);
    const placement = found.story.placement;
    const allowed =
      placement?.mode === "local-only"
        ? ["local"]
        : placement?.mode === "required"
          ? [placement.machineId]
          : placement?.mode === "preferred"
            ? [placement.machineId, ...policy.order]
            : policy.order;
    if (!allowed.includes(e.machineId)) return `placement no longer allows ${e.machineId}`;
    if (!policy.machines[e.machineId]?.enabled) return `${e.machineId} is no longer configured and enabled`;
    const evidence = eligibilityFor(tx, {
      ...(e.agent ? { agent: e.agent } : {}),
      ...(e.model ? { model: e.model } : {}),
    })[e.machineId];
    if (!evidence || evidence.failures.length)
      return `${e.machineId} is no longer eligible${evidence?.detail ? `: ${evidence.detail}` : ""}`;
    return null;
  }

  async function requestAttempt(id: string, kind: ExecutionAttempt["kind"]) {
    return mutate((tx) => {
      const e = tx.rt.executions[id];
      if (!e) throw new SfError("not_found", `no execution ${id}`);
      if (!occupies(e)) throw new SfError("invalid", `execution ${id} already ended (${e.outcome})`);
      if (e.status === "reserved")
        throw new SfError("invalid", `execution ${id} was never delivered; release or Move its Story instead`);
      if (e.attempt?.kind === kind && (!e.attempt.commandId || isOutstanding(e.attempt)))
        return executionView(tx.rt, e);
      newAttempt(e, kind);
      return executionView(tx.rt, e);
    });
  }

  function isOutstanding(attempt: ExecutionAttempt) {
    const state = attempt.commandId ? boundary.commandState?.(attempt.commandId) : undefined;
    if (state === "pending") return true;
    return (state === "claimed" || state === undefined) && now() - attempt.requestedAt < ATTEMPT_TIMEOUT_MS;
  }

  function executionView(rt: RuntimeState, e: Execution): ExecutionView {
    const live = claimLive(rt, e);
    const { intent: _, ...rest } = e;
    const pending = e.attempt
      ? `; ${e.attempt.kind} ${e.attempt.id} is with the Supervisor`
      : e.recovery
        ? `; recovery needed: ${e.recovery}`
        : e.nextAttemptAt
          ? `; next lookup after ${new Date(e.nextAttemptAt).toISOString()}`
          : "";
    const waitingFor =
      e.status === "terminal"
        ? `ended (${e.outcome})${e.conflict ? `; conflicting report: ${e.conflict}` : ""}`
        : e.status === "reserved"
          ? "waiting for the Supervisor to receive the launch command"
          : e.status === "launching"
            ? "waiting for the Supervisor's launch result"
            : e.status === "running" && live
              ? "running; the Worker holds the Claim"
              : `${e.status === "running" ? "the Claim ended; waiting for evidence that the execution ended" : `unconfirmed: ${e.evidence ?? "no evidence"}`}${pending}`;
    return { ...rest, occupying: occupies(e), claimLive: live, waitingFor };
  }

  function executionOf(rt: RuntimeState, workerId: string): Execution | undefined {
    const id = rt.workers[workerId]?.executionId;
    return (id && rt.executions[id]) || Object.values(rt.executions).find((e) => e.workerId === workerId);
  }

  function usageOf(rt: RuntimeState) {
    const usage: Record<string, number> = {};
    for (const e of Object.values(rt.executions)) if (occupies(e)) usage[e.machineId] = (usage[e.machineId] ?? 0) + 1;
    return usage;
  }

  function claimLive(rt: RuntimeState, e: Execution) {
    return rt.claims[e.storyKey]?.workerId === e.workerId;
  }

  /** Ends the Claim's authority. Its execution keeps occupying until terminal evidence arrives. */
  function endClaim(tx: Tx, key: string, reason: WorkerEndReason) {
    const claim = tx.rt.claims[key];
    if (!claim) return;
    delete tx.rt.claims[key];
    const worker = tx.rt.workers[claim.workerId];
    if (worker) Object.assign(worker, { endedAt: now(), endReason: reason });
    const e = claim.executionId ? tx.rt.executions[claim.executionId] : executionOf(tx.rt, claim.workerId);
    if (!e || !occupies(e)) return;
    if (e.status === "reserved") {
      // Never delivered: the delivery gate rejects it from now on.
      finishExecution(tx, e, "not-started", `Claim ended (${reason}) before the launch command was delivered`);
    } else if (reason === "timeout" || reason === "force-released") {
      Object.assign(e, {
        status: "unknown",
        updatedAt: now(),
        evidence: `Claim ${reason === "timeout" ? "timed out" : "force-released"}; the execution may still be running`,
      });
    } else
      Object.assign(e, { updatedAt: now(), evidence: `Claim ended (${reason}); waiting for the execution to end` });
  }

  function finishExecution(tx: Tx, e: Execution, outcome: ExecutionOutcome, evidence: string) {
    Object.assign(e, { status: "terminal", outcome, evidence, endedAt: now(), updatedAt: now() });
    delete e.intent;
    delete e.attempt;
    delete e.recovery;
    delete e.nextAttemptAt;
    if (claimLive(tx.rt, e)) endClaim(tx, e.storyKey, outcome === "not-started" ? "spawn-failed" : "execution-ended");
    if (tx.rt.deferredCleanups[e.storyKey] && !occupant(tx.rt, e.storyKey)) {
      delete tx.rt.deferredCleanups[e.storyKey];
      scheduleCleanup(tx, e.storyKey);
    }
  }

  /** Applies correlated evidence to its launch generation. Throws on mismatched identity. */
  function applyReport(tx: Tx, e: Execution, report: ExecutionReport): { applied: boolean; reason?: string } {
    const mismatch = (
      [
        ["executionId", report.executionId, e.id],
        ["machineId", report.machineId, e.machineId],
        ["environmentId", report.environmentId, e.environmentId],
        ["projectId", report.projectId, e.projectId],
        ["worktree.path", report.worktree?.path, e.worktree.path],
        ["worktree.branch", report.worktree?.branch, e.worktree.branch],
        ["taskId", report.taskId, e.taskId ?? report.taskId],
        ["threadId", report.threadId, e.threadId ?? report.threadId],
      ] as const
    ).find(([, given, recorded]) => given !== undefined && given !== recorded);
    if (mismatch)
      throw new SfError(
        "invalid",
        `execution ${e.id}: ${mismatch[0]} "${mismatch[1]}" does not match the recorded "${mismatch[2]}"`,
      );
    if (report.attemptId !== undefined && e.attempt?.id !== report.attemptId)
      return { applied: false, reason: `attempt ${report.attemptId} is not the outstanding attempt` };
    if (report.taskId) e.taskId = report.taskId;
    if (report.threadId) e.threadId = report.threadId;
    if (report.adapterEnvironmentId || report.adapterProjectId)
      e.adapter = {
        ...e.adapter,
        ...(report.adapterEnvironmentId ? { environmentId: report.adapterEnvironmentId } : {}),
        ...(report.adapterProjectId ? { projectId: report.adapterProjectId } : {}),
      };
    const evidence = report.evidence ?? `reported ${report.status}`;
    const answered = report.attemptId !== undefined;
    if (!occupies(e)) {
      const outcome = report.status === "terminal" ? report.outcome : report.status;
      if (outcome === e.outcome) return { applied: false, reason: "already recorded" };
      if (report.status === "terminal" || report.status === "not-started") {
        e.conflict = `reported ${outcome} after ${e.outcome}: ${evidence}`;
        return { applied: true };
      }
      // A live report contradicts the recorded end: occupy again until reconciled.
      Object.assign(e, {
        status: "unknown",
        conflict: `reported ${report.status} after ${e.outcome}: ${evidence}`,
        evidence,
        updatedAt: now(),
      });
      delete e.endedAt;
      delete e.outcome;
      return { applied: true };
    }
    if (report.status === "terminal" || report.status === "not-started") {
      if (report.status === "not-started" && claimLive(tx.rt, e))
        tx.rt.failures[e.storyKey] = { stageId: e.stageId, error: evidence, at: now() };
      finishExecution(tx, e, report.status === "terminal" ? report.outcome! : "not-started", evidence);
      delete e.conflict;
      drainQueue(tx);
      return { applied: true };
    }
    if (report.status === "running") {
      if (e.status !== "running") e.acceptedAt = now();
      e.status = "running";
      const claim = tx.rt.claims[e.storyKey];
      if (claim?.workerId === e.workerId && claim.status === "spawning")
        Object.assign(claim, { status: "active", lastSeenAt: now() });
    } else e.status = "unknown";
    Object.assign(e, { evidence, updatedAt: now() });
    if (answered) completeAttempt(e);
    return { applied: true };
  }

  function completeAttempt(e: Execution) {
    delete e.attempt;
    e.attempts++;
    e.nextAttemptAt = now() + Math.min(ATTEMPT_BACKOFF_MS * 2 ** (e.attempts - 1), MAX_BACKOFF_MS);
  }

  /** Issues bounded lookups for executions whose end sf cannot confirm on its own. */
  function scheduleAttempts(tx: Tx) {
    if (!online) return;
    const support = boundary.support();
    let outstanding = Object.values(tx.rt.executions).filter((e) => e.attempt).length;
    for (const e of Object.values(tx.rt.executions)) {
      if (!occupies(e)) continue;
      if (e.attempt) {
        const state = e.attempt.commandId ? boundary.commandState?.(e.attempt.commandId) : "pending";
        // Only a still-queued command is exempt: a claimed one the Supervisor never answers expires.
        if (state === "pending" || now() - e.attempt.requestedAt < ATTEMPT_TIMEOUT_MS) continue;
        e.evidence = `${e.attempt.kind} attempt ${e.attempt.id} got no answer`;
        completeAttempt(e);
        outstanding--;
      }
      const needs =
        e.status === "unknown" || ((e.status === "running" || e.status === "launching") && !claimLive(tx.rt, e));
      if (!needs || now() < (e.nextAttemptAt ?? 0)) continue;
      if (!e.taskId && !e.threadId && !e.label && support.lookupByRequest !== true) {
        e.recovery =
          `no task or thread identity was reported and ${support.lookupByRequest}; ` +
          `report confirmed evidence with \`sf execution report ${e.id}\` or ask the Supervisor with \`sf execution reconcile ${e.id}\``;
        continue;
      }
      if (outstanding >= MAX_OUTSTANDING_ATTEMPTS) continue;
      newAttempt(e, "reconcile");
      outstanding++;
    }
  }

  function newAttempt(e: Execution, kind: ExecutionAttempt["kind"]) {
    e.attempt = { id: `a-${crypto.randomBytes(4).toString("hex")}`, kind, requestedAt: now() };
    delete e.recovery;
  }

  /** Ends Claims whose Worker ran no sf command for the claim timeout, and trims old history. */
  function sweep(tx: Tx) {
    const ended = Object.values(tx.rt.executions)
      .filter((e) => !occupies(e))
      .sort((a, b) => (b.endedAt ?? 0) - (a.endedAt ?? 0));
    for (const e of ended.slice(MAX_ENDED_EXECUTIONS)) delete tx.rt.executions[e.id];
    for (const [key, claim] of Object.entries(tx.rt.claims)) {
      let board: BoardConfig | undefined;
      try {
        board = loadBoard(root, claim.board);
      } catch {
        board = undefined;
      }
      const timeout = resolveSettings(tx.project, board).claimTimeoutMinutes * 60_000;
      if (now() - claim.lastSeenAt > timeout) endClaim(tx, key, "timeout");
    }
  }

  /** Explicit eligibility evidence per configured machine. Missing evidence is incompatible. */
  function eligibilityFor(tx: Tx, request: { agent?: string; model?: string }) {
    const support = boundary.support();
    const machines = ["local", ...(tx.project.scheduling?.remotes.map((r) => r.id) ?? [])];
    const evidence: Record<string, TargetEligibility> = boundary.eligibility?.(machines, request) ?? {
      local: support.local === true ? { failures: [] } : { failures: ["incompatible"], detail: support.local },
      ...Object.fromEntries(
        machines
          .slice(1)
          .map((id) => [
            id,
            support.remote === true ? { failures: [] } : { failures: ["incompatible"], detail: support.remote },
          ]),
      ),
    };
    // A changed mapping under an occupied slug keeps the old charge and blocks new launches there.
    for (const remote of tx.project.scheduling?.remotes ?? []) {
      const stale = Object.values(tx.rt.executions).find(
        (e) =>
          occupies(e) &&
          e.machineId === remote.id &&
          (e.environmentId !== remote.environmentId || e.projectId !== remote.project.projectId),
      );
      if (stale)
        evidence[remote.id] = {
          failures: [...(evidence[remote.id]?.failures ?? []), "unmapped"],
          detail: `mapping changed while execution ${stale.id} still occupies ${remote.id}`,
        };
    }
    return evidence;
  }

  function identityFor(tx: Tx, machineId: string) {
    const remote = tx.project.scheduling?.remotes.find((r) => r.id === machineId);
    return remote ? { environmentId: remote.environmentId, projectId: remote.project.projectId } : tx.rt.identity;
  }

  function enqueueSpawn(tx: Tx, key: string, boardId: string, stageId: string) {
    tx.rt.queue.push({ storyKey: key, board: boardId, stageId, queuedAt: now(), seq: ++tx.rt.queueSeq });
  }

  /** Reserves capacity for queued spawns, oldest eligible first, skipping entries that must wait. */
  function drainQueue(tx: Tx) {
    if (!online || !tx.rt.queue.length) return;
    const policy = normalizePlacementPolicy(tx.project);
    const usage = usageOf(tx.rt);
    const ordered = [...tx.rt.queue].sort((a, b) => a.queuedAt - b.queuedAt || (a.seq ?? 0) - (b.seq ?? 0));
    for (const entry of ordered) {
      const drop = () => {
        tx.rt.queue = tx.rt.queue.filter((q) => q !== entry);
      };
      const found = tryLocate(entry.storyKey);
      if (!found || tx.rt.claims[entry.storyKey] || found.story.stage !== entry.stageId) {
        drop();
        continue;
      }
      if (!spawnsFor(found.boardId, found.board, entry.stageId, found.story)) {
        if (unresolved(found.story).length) tx.rt.dependencyWaits[entry.storyKey] = { stageId: entry.stageId };
        drop();
        continue;
      }
      const busy = occupant(tx.rt, entry.storyKey);
      if (busy) {
        setWait(entry, [{ code: "branch-occupied", executionId: busy.id }]);
        continue;
      }
      const stage = found.board.stages.find((s) => s.id === entry.stageId);
      const settings = resolveSettings(tx.project, found.board, stage, found.story);
      const request = {
        ...(settings.agent ? { agent: settings.agent } : {}),
        ...(settings.model ? { model: settings.model } : {}),
      };
      const placement = selectPlacement(policy, found.story.placement, eligibilityFor(tx, request), usage);
      if (placement.kind === "wait") {
        setWait(entry, placement.reasons);
        continue;
      }
      // Runtime is saved even on error; a failed spawn keeps its entry and age for the next drain.
      try {
        spawnNow(tx, entry.storyKey, found.boardId, entry.stageId, placement.machineId);
      } catch (err) {
        failedSpawn = entry;
        throw err;
      }
      drop();
      delete tx.rt.dependencyWaits[entry.storyKey];
      usage[placement.machineId] = (usage[placement.machineId] ?? 0) + 1;
    }
  }

  let failedSpawn: QueueEntry | undefined;

  function setWait(entry: QueueEntry, reasons: QueueWait["reasons"]) {
    if (JSON.stringify(entry.wait?.reasons) !== JSON.stringify(reasons)) entry.wait = { at: now(), reasons };
  }

  function requestSpawn(tx: Tx, key: string, boardId: string, stageId: string) {
    const { rt } = tx;
    const found = locate(key);
    if (rt.claims[key]) return;
    if (unresolved(found.story).length) {
      rt.dependencyWaits[key] = { stageId };
      dropSpawn(tx, key);
      return;
    }
    if (!spawnsFor(boardId, found.board, stageId, found.story)) return;
    if (rt.queue.some((q) => q.storyKey === key && q.stageId === stageId)) {
      delete rt.dependencyWaits[key];
      return;
    }
    rt.queue = rt.queue.filter((q) => q.storyKey !== key);
    if (!online) {
      rt.pendingTriggers = rt.pendingTriggers.filter((t) => !(t.type === "spawn" && t.storyKey === key));
      rt.pendingTriggers.push({ type: "spawn", storyKey: key, stageId, at: now() });
      delete rt.dependencyWaits[key];
      return;
    }
    // Every request takes its place in FIFO order, behind older eligible work.
    enqueueSpawn(tx, key, boardId, stageId);
    const wait = rt.dependencyWaits[key];
    delete rt.dependencyWaits[key];
    const entry = rt.queue.at(-1);
    failedSpawn = undefined;
    try {
      drainQueue(tx);
    } catch (err) {
      // The caller retains a request that failed to start (as a pending trigger or by rethrowing).
      if (failedSpawn === entry) {
        rt.queue = rt.queue.filter((q) => q !== entry);
        if (wait) rt.dependencyWaits[key] = wait;
      }
      throw err;
    }
  }

  /** Reserves the machine, Claim and launch identity. The command is published after the save. */
  function spawnNow(tx: Tx, key: string, boardId: string, stageId: string, machineId: string) {
    const { board, story } = locate(key);
    const stage = board.stages.find((s) => s.id === stageId)!;
    const settings = resolveSettings(tx.project, board, stage, story);
    const workerId = `w-${crypto.randomBytes(4).toString("hex")}`;
    const executionId = `x-${crypto.randomBytes(6).toString("hex")}`;
    const worktree = { path: worktreePath(root, key), branch: storyBranch(key) };
    const mode = opts.spawnMode?.() ?? "subagent";
    const machine = machineRequest(tx.project.scheduling, story.placement, machineId, worktree.branch);
    const brief = composeBrief({
      storyKey: key,
      story,
      boardId,
      board,
      stageId,
      root,
      worktree,
      workerId,
      sf: opts.sf ?? "sf",
      preamble: settings.briefPreamble,
      projectInstructions: instructionText(paths.instructions),
      boardInstructions: instructionText(paths.boardInstructions(boardId)),
      prompt: promptText(boardId, stageId),
      effectiveModel: resolveModel(tx.project, board, stage, story),
      ...(machine ? { machine } : {}),
    });
    const t = now();
    const execution: Execution = {
      id: executionId,
      workerId,
      storyKey: key,
      board: boardId,
      stageId,
      machineId,
      ...identityFor(tx, machineId),
      worktree,
      mode,
      ...(settings.agent ? { agent: settings.agent } : {}),
      ...(settings.model ? { model: settings.model } : {}),
      status: "reserved",
      createdAt: t,
      updatedAt: t,
      attempts: 0,
    };
    execution.intent = {
      type: "worker.spawn",
      workerId,
      storyKey: key,
      board: boardId,
      stageId,
      mode,
      ...(settings.agent ? { agent: settings.agent } : {}),
      ...(settings.model ? { model: settings.model } : {}),
      worktree,
      brief,
      execution: executionRef(execution),
      ...(machine ? { machine } : {}),
    };
    tx.rt.executions[executionId] = execution;
    tx.rt.claims[key] = {
      workerId,
      board: boardId,
      stageId,
      status: "spawning",
      claimedAt: t,
      lastSeenAt: t,
      executionId,
      machineId,
    };
    tx.rt.workers[workerId] = { storyKey: key, stageId, mode, startedAt: t, executionId, machineId };
    delete tx.rt.failures[key];
  }

  /** Rejects with "claim is gone" unless `workerId` holds a live Claim. Refreshes it. Returns its Story Key. */
  function checkWorker(tx: Tx, workerId: string) {
    const worker = tx.rt.workers[workerId];
    const claim = worker && tx.rt.claims[worker.storyKey];
    if (!worker || worker.endedAt || !claim || claim.workerId !== workerId)
      throw new SfError("claim_gone", "claim is gone");
    claim.lastSeenAt = now();
    return worker.storyKey;
  }

  /** Done cleanup waits while an execution still occupies the Story branch. */
  function scheduleCleanup(tx: Tx, key: string) {
    if (!online) tx.rt.pendingTriggers.push({ type: "cleanup", storyKey: key, at: now() });
    else if (occupant(tx.rt, key)) tx.rt.deferredCleanups[key] = { at: now() };
    else tx.after.push(() => removeWorktree(key, false, true));
  }

  /** What follows a Story entering a Stage (a Move or a create). A Story held for HIL waits. */
  function enterStage(tx: Tx, key: string, boardId: string, board: BoardConfig, story: StoryData, claimEnded: boolean) {
    const stageId = story.stage;
    if (unresolved(story).length) tx.rt.dependencyWaits[key] = { stageId };
    if (stageId === DONE) scheduleCleanup(tx, key);
    if (claimEnded && online) {
      // Persist this Story's intent before a drain can fail, behind older spawns.
      if (spawnsFor(boardId, board, stageId, story)) enqueueSpawn(tx, key, boardId, stageId);
      drainQueue(tx);
    } else if (spawnsFor(boardId, board, stageId, story)) requestSpawn(tx, key, boardId, stageId);
  }

  /** Drops any queued or pending spawn for the Story. */
  function dropSpawn(tx: Tx, key: string) {
    tx.rt.queue = tx.rt.queue.filter((q) => q.storyKey !== key);
    tx.rt.pendingTriggers = tx.rt.pendingTriggers.filter((t) => !(t.type === "spawn" && t.storyKey === key));
  }

  function requireStage(board: BoardConfig, stageId: string) {
    const stage = board.stages.find((s) => s.id === stageId);
    if (!stage) throw new SfError("not_found", `no Stage "${stageId}" on Board ${board.key}`);
    return stage;
  }

  function cleanFields(fields: Record<string, unknown>) {
    validateBuiltinFields(fields);
    return Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== null && v !== undefined));
  }

  /** Removes the Story Worktree; for a Story in Done, also deletes its branch once merged. */
  async function removeWorktree(
    key: string,
    force: boolean,
    onlyIfDone = false,
  ): Promise<CleanupResult | (CleanupResult & { deferred: string })> {
    // Serialize the existence check and git operation with deletion. A deferred
    // Done cleanup must never remove artifacts after its Story has been deleted.
    const result = await withLock(root, async (): Promise<CleanupResult | (CleanupResult & { deferred: string })> => {
      const found = tryLocate(key);
      if (!found && onlyIfDone) return { removed: false, path: worktreePath(root, key), branch: storyBranch(key) };
      const busy = occupant(loadRuntime(root), key);
      // A deferred Done cleanup runs again once the execution ends; explicit removal is refused.
      if (busy && onlyIfDone)
        return { removed: false, path: worktreePath(root, key), branch: storyBranch(key), deferred: busy.id };
      if (busy) fence(loadRuntime(root), key);
      const { board, story } = found ?? locate(key);
      if (onlyIfDone && story.stage !== DONE)
        return { removed: false, path: worktreePath(root, key), branch: storyBranch(key) };
      const settings = resolveSettings(loadProjectConfig(root), board);
      try {
        const base = await resolveBaseBranch(git, root, settings.baseBranch);
        return await cleanupWorktree(git, root, key, base, { force, deleteBranch: story.stage === DONE });
      } catch (err) {
        return {
          removed: false,
          path: worktreePath(root, key),
          branch: storyBranch(key),
          reason: (err as Error).message,
        };
      }
    });
    await mutate((tx) => {
      const { rt } = tx;
      if (!tryLocate(key)) return;
      if ("deferred" in result) {
        if (!occupant(rt, key)) scheduleCleanup(tx, key);
        else rt.deferredCleanups[key] = { at: now() };
        return;
      }
      if (result.reason)
        rt.worktreeWarnings[key] = { path: result.path, branch: result.branch, reason: result.reason, at: now() };
      else delete rt.worktreeWarnings[key];
    });
    return result;
  }

  // ---------- operations ----------

  const service = {
    root,

    /** Creates `.sf/`, `sf.config.json`, and `.sf/.gitignore` when missing. */
    init(): ProjectConfig {
      fs.mkdirSync(paths.boards, { recursive: true });
      if (!fs.existsSync(paths.config)) writeJson(paths.config, DEFAULT_PROJECT_CONFIG);
      if (!fs.existsSync(paths.gitignore)) atomicWrite(paths.gitignore, "runtime/\n");
      return loadProjectConfig(root);
    },

    showProject() {
      const config = loadProjectConfig(root);
      return {
        config,
        effectiveModel: resolveModel(config),
        modelOptions: modelCatalog(config, undefined, [config.worker.model]),
      };
    },

    async updateProject(patch: UpdateProjectRequest) {
      return mutate(() => {
        const config = loadProjectConfig(root);
        if (patch.model !== undefined) {
          validateModel(patch.model);
          config.worker.model = patch.model || null;
        }
        if (patch.modelOptions !== undefined) config.modelOptions = normalizeModelOptions(patch.modelOptions);
        if (patch.addModelOptions !== undefined)
          config.modelOptions = mergeOptions(config.modelOptions, patch.addModelOptions);
        writeJson(paths.config, config);
        return service.showProject();
      });
    },

    hasProject() {
      return fs.existsSync(paths.config);
    },

    async createBoard(name: string, key: string) {
      service.init();
      return mutate(() => {
        const id = slug(name) || key.toLowerCase();
        if (fs.existsSync(paths.board(id))) throw new SfError("invalid", `Board ${id} already exists`);
        for (const other of listBoardIds(root))
          if (loadBoard(root, other).key === key)
            throw new SfError("invalid", `Board key ${key} is already used by ${other}`);
        const config = defaultBoard(name.trim(), key);
        saveBoard(root, id, config);
        fs.mkdirSync(paths.stories(id), { recursive: true });
        fs.mkdirSync(paths.stages(id), { recursive: true });
        return { id, config };
      });
    },

    async updateBoard(ref: string, patch: BoardPatch) {
      return mutate(() => {
        const { id, config } = boardRef(ref);
        if (patch.schema !== undefined) {
          if (config.schema.some((f) => f.id === "model"))
            throw new SfError(
              "invalid",
              "legacy custom field model conflicts with the built-in model; rename it and its Story data before changing the schema",
            );
          validateSchema(patch.schema);
        }
        validateModel(patch.model);
        const next: BoardConfig = {
          ...config,
          ...(patch.name !== undefined ? { name: patch.name.trim() } : {}),
          ...(patch.schema !== undefined ? { schema: patch.schema } : {}),
          overrides: {
            ...config.overrides,
            ...patch.overrides,
            worker: {
              ...config.overrides.worker,
              ...patch.overrides?.worker,
              ...(patch.model !== undefined ? { model: patch.model || null } : {}),
            },
            worktree: { ...config.overrides.worktree, ...patch.overrides?.worktree },
          },
          ...(patch.modelOptions !== undefined ? { modelOptions: normalizeModelOptions(patch.modelOptions) } : {}),
        };
        if (patch.addModelOptions !== undefined)
          next.modelOptions = mergeOptions(next.modelOptions, patch.addModelOptions);
        saveBoard(root, id, next);
        return service.showBoard(id);
      });
    },

    async addStage(ref: string, name: string, after?: string) {
      return mutate(() => {
        const { id, config } = boardRef(ref);
        let index = config.stages.length - 1;
        if (after) {
          requireStage(config, after);
          if (after === DONE) throw new SfError("invalid", "Done must stay the last Stage");
          index = config.stages.findIndex((s) => s.id === after) + 1;
        }
        const stage = {
          id: uniqueId(
            slug(name),
            config.stages.map((s) => s.id),
          ),
          name: name.trim(),
          promptEnabled: false,
        };
        config.stages.splice(index, 0, stage);
        saveBoard(root, id, config);
        return stage;
      });
    },

    async updateStage(ref: string, stageId: string, patch: StagePatch) {
      return mutate(() => {
        const { id, config } = boardRef(ref);
        const stage = requireStage(config, stageId);
        validateModel(patch.model);
        if (isFixedStage(stageId)) {
          if (patch.name !== undefined && patch.name !== stage.name)
            throw new SfError("invalid", `${stage.name} cannot be renamed`);
          if (patch.promptEnabled || patch.prompt?.trim())
            throw new SfError("invalid", `${stage.name} cannot have a Stage Prompt`);
        }
        if (patch.name !== undefined) stage.name = patch.name.trim();
        if (patch.promptEnabled !== undefined) stage.promptEnabled = patch.promptEnabled;
        for (const k of ["agent", "model"] as const) {
          const v = patch[k];
          if (v === undefined) continue;
          if (v) stage[k] = v;
          else delete stage[k];
        }
        if (patch.hilFlag !== undefined || patch.hilComment !== undefined) {
          const flag = patch.hilFlag !== undefined ? patch.hilFlag : stage.hil?.flag;
          const comment = patch.hilComment !== undefined ? patch.hilComment : stage.hil?.comment;
          if (flag) stage.hil = { flag, ...(comment ? { comment } : {}) };
          else if (patch.hilComment) throw new SfError("invalid", "a HIL comment field needs a HIL flag field");
          else delete stage.hil;
        }
        validateModel(stage.model);
        validateBoard({ ...config, schema: config.schema.filter((f) => f.id !== "model") });
        const file = path.join(paths.stages(id), `${stageId}.md`);
        const { metadata, body } = readStage(file);
        const selection = stage.model;
        if (selection) metadata.model = selection;
        else delete metadata.model;
        delete stage.model;
        // Remove legacy JSON before writing a cleared Markdown key, preventing resurrection.
        saveBoard(root, id, config);
        atomicWrite(file, serializeStage(metadata, patch.prompt ?? body));
        const updated = loadBoard(root, id).stages.find((s) => s.id === stageId)!;
        return {
          ...updated,
          prompt: promptText(id, stageId),
          effectiveModel: resolveModel(loadProjectConfig(root), config, { ...stage, model: selection }),
          modelOptions: modelCatalog(loadProjectConfig(root), config, [selection]),
        };
      });
    },

    async reorderStage(ref: string, stageId: string, index: number) {
      return mutate(() => {
        const { id, config } = boardRef(ref);
        const stage = requireStage(config, stageId);
        if (isFixedStage(stageId)) throw new SfError("invalid", `${stage.name} cannot be moved`);
        if (!Number.isInteger(index) || index < 1 || index > config.stages.length - 2)
          throw new SfError("invalid", `index must be between 1 and ${config.stages.length - 2}`);
        config.stages.splice(config.stages.indexOf(stage), 1);
        config.stages.splice(index, 0, stage);
        saveBoard(root, id, config);
        return config.stages;
      });
    },

    async removeStage(ref: string, stageId: string) {
      return mutate(() => {
        const { id, config } = boardRef(ref);
        const stage = requireStage(config, stageId);
        if (isFixedStage(stageId)) throw new SfError("invalid", `${stage.name} cannot be removed`);
        const held = storyViews(id).filter((s) => s.stage === stageId);
        if (held.length)
          throw new SfError(
            "invalid",
            `Stage ${stageId} still holds ${held.map((s) => s.key).join(", ")}; move them first`,
          );
        config.stages.splice(config.stages.indexOf(stage), 1);
        saveBoard(root, id, config);
        fs.rmSync(path.join(paths.stages(id), `${stageId}.md`), { force: true });
        return config.stages;
      });
    },

    async createStory(ref: string, input: StoryInput, actor: Actor): Promise<StoryDetails> {
      return mutate((tx) => {
        if (actor.kind === "worker") checkWorker(tx, actor.id);
        const { id, config } = boardRef(ref);
        if (input.submissionId) {
          for (const existing of storyViews(id)) {
            if (attachmentStore(paths.attachments(id, existing.key)).hasSubmission(input.submissionId))
              return details(tx.rt, existing);
          }
        }
        const stageId = input.stage ?? BACKLOG;
        requireStage(config, stageId);
        const title = input.title?.trim();
        if (!title) throw new SfError("invalid", "a Story needs a title");
        const placement = validatePlacement(input.placement, tx.project.scheduling);
        validateModel(input.model);
        checkStoryModel(config, input.model, input.fields);
        const fields = cleanFields(input.fields ?? {});
        validateFields(config.schema, fields);
        const number = Math.max(config.storyNumber ?? 0, nextStoryNumber(paths.stories(id), config.key) - 1) + 1;
        config.storyNumber = number;
        // Reserve the Key before writing: a failed write may leave a gap, never a reused Key.
        saveBoard(root, id, config);
        const key = `${config.key}-${number}`;
        const dependsOn = validateDependencies(key, input.dependsOn === undefined ? [] : input.dependsOn);
        const story: StoryData = {
          title,
          stage: stageId,
          dependsOn,
          ...(input.model ? { model: input.model } : {}),
          ...(placement ? { placement } : {}),
          fields,
          body: input.body ?? "",
        };
        const storage = attachmentStore(paths.attachments(id, key));
        storage.hasSubmission(input.submissionId);
        storage.commit(
          input.attachments,
          input.submissionId,
          () => writeStory(id, key, story),
          () => fs.rmSync(storyFile(id, key), { force: true }),
        );
        enterStage(tx, key, id, config, story, false);
        return details(tx.rt, view(key, id, story));
      });
    },

    async deleteStory(key: string, actor: Actor) {
      // Do not drain first: a queued Story must remain deletable when capacity opens.
      return mutate((tx) => {
        if (actor.kind === "worker") checkWorker(tx, actor.id);
        const { boardId, board } = locate(key);
        const dependents = allStories().filter((s) => s.dependsOn?.includes(key));
        if (dependents.length)
          throw new SfError(
            "invalid",
            `cannot delete ${key}; required by ${dependents.map((s) => s.key).join(", ")}. Clear those dependencies first`,
          );
        const claim = tx.rt.claims[key];
        if (claim)
          throw new SfError(
            "claimed",
            `${key} is claimed by Worker ${claim.workerId}; release the Claim before deletion`,
          );
        // Migrate older Boards before removing any file, including their highest Story.
        board.storyNumber = Math.max(board.storyNumber ?? 0, nextStoryNumber(paths.stories(boardId), board.key) - 1);
        saveBoard(root, boardId, board);
        fs.unlinkSync(storyFile(boardId, key));
        dropSpawn(tx, key);
        tx.rt.pendingTriggers = tx.rt.pendingTriggers.filter((t) => t.storyKey !== key);
        delete tx.rt.dependencyWaits[key];
        delete tx.rt.failures[key];
        delete tx.rt.worktreeWarnings[key];
        drainQueue(tx);
        return { key };
      }, false);
    },

    async updateStory(key: string, patch: StoryPatch, actor: Actor): Promise<StoryDetails> {
      return mutate((tx) => {
        if (actor.kind === "worker") checkWorker(tx, actor.id);
        const { boardId, board, story } = locate(key);
        const storage = attachmentStore(paths.attachments(boardId, key));
        if (storage.hasSubmission(patch.submissionId)) return details(tx.rt, view(key, boardId, story));
        const placement =
          patch.placement === undefined ? story.placement : validatePlacement(patch.placement, tx.project.scheduling);
        validateBuiltinFields(patch.fields ?? {});
        validateModel(patch.model);
        checkStoryModel(board, patch.model, patch.fields);
        if (patch.model !== undefined && Object.hasOwn(story.fields, "model"))
          throw new SfError(
            "invalid",
            "existing model metadata conflicts with the built-in model; rename it and its data first",
          );
        const fields = { ...story.fields };
        for (const [k, v] of Object.entries(patch.fields ?? {})) {
          if (v === null || v === undefined) delete fields[k];
          else fields[k] = v;
        }
        validateFields(board.schema, fields);
        if (patch.title !== undefined && !patch.title.trim()) throw new SfError("invalid", "a Story needs a title");
        const next: StoryData = {
          ...story,
          placement,
          title: patch.title?.trim() ?? story.title,
          ...(patch.dependsOn !== undefined ? { dependsOn: validateDependencies(key, patch.dependsOn) } : {}),
          ...(patch.model !== undefined ? { model: patch.model || undefined } : {}),
          fields,
          body: patch.body ?? story.body,
        };
        storage.commit(
          patch.attachments,
          patch.submissionId,
          () => writeStory(boardId, key, next),
          () => writeStory(boardId, key, story),
        );
        // Hold: a Story whose HIL flag is set waits. Wake: clearing the flag spawns as if the Story had just entered.
        const wasHeld = Boolean(activeHil(board, story));
        const held = Boolean(activeHil(board, next));
        if (held && !wasHeld) dropSpawn(tx, key);
        if (
          patch.dependsOn !== undefined &&
          JSON.stringify(next.dependsOn ?? []) !== JSON.stringify(story.dependsOn ?? [])
        )
          tx.rt.dependencyWaits[key] = { stageId: next.stage };
        if (unresolved(next).length) {
          tx.rt.dependencyWaits[key] = { stageId: next.stage };
          dropSpawn(tx, key);
        }
        if (wasHeld && !held && !tx.rt.claims[key] && stageSpawns(boardId, board, next.stage))
          requestSpawn(tx, key, boardId, next.stage);
        reconcileDependencies(tx);
        return details(tx.rt, view(key, boardId, next));
      });
    },

    async listAttachments(key: string, actor: Actor) {
      return mutate((tx) => {
        if (actor.kind === "worker") checkWorker(tx, actor.id);
        const { boardId } = locate(key);
        return attachmentStore(paths.attachments(boardId, key)).list();
      });
    },
    async getAttachment(key: string, id: string, actor: Actor) {
      return mutate((tx) => {
        if (actor.kind === "worker") checkWorker(tx, actor.id);
        const { boardId } = locate(key);
        return attachmentStore(paths.attachments(boardId, key)).get(id);
      });
    },
    async addAttachment(key: string, input: AttachmentInput, actor: Actor) {
      return mutate((tx) => {
        if (actor.kind === "worker") checkWorker(tx, actor.id);
        const { boardId } = locate(key);
        return attachmentStore(paths.attachments(boardId, key)).commit(
          [input],
          undefined,
          () => {},
          () => {},
        )[0]!;
      });
    },

    async moveStory(key: string, stageId: string, actor: Actor): Promise<StoryDetails> {
      return mutate((tx) => {
        const { rt } = tx;
        const workerId = actor.kind === "worker" ? actor.id : null;
        if (workerId) checkWorker(tx, workerId);
        const { boardId, board, story } = locate(key);
        requireStage(board, stageId);
        if (story.stage === stageId) throw new SfError("invalid", `${key} is already in ${stageId}`);
        const claim = rt.claims[key];
        if (claim && claim.workerId !== workerId)
          throw new SfError("claimed", `${key} is claimed by Worker ${claim.workerId}`);

        const next = { ...story, stage: stageId };
        writeStory(boardId, key, next);
        delete rt.failures[key];
        dropSpawn(tx, key);
        delete rt.dependencyWaits[key];
        if (claim) endClaim(tx, key, "moved");
        enterStage(tx, key, boardId, board, next, Boolean(claim));
        return details(rt, view(key, boardId, next));
      });
    },

    async waitStory(key: string, dependsOn: string[], actor: Actor) {
      if (actor.kind !== "worker") throw new SfError("invalid", "wait needs --worker <id>");
      return mutate((tx) => {
        if (checkWorker(tx, actor.id) !== key) throw new SfError("claim_gone", "claim is gone");
        const { boardId, story } = locate(key);
        const keys = validateDependencies(key, dependsOn);
        if (!keys.length)
          throw new SfError(
            "invalid",
            "wait requires at least one dependency; use update --depends-on '' to clear dependencies",
          );
        writeStory(boardId, key, { ...story, dependsOn: keys });
        tx.rt.dependencyWaits[key] = { stageId: story.stage };
        endClaim(tx, key, "released");
        reconcileDependencies(tx);
        drainQueue(tx);
        return details(tx.rt, storyView(key));
      });
    },

    async releaseStory(key: string, actor: Actor) {
      if (actor.kind !== "worker")
        throw new SfError("invalid", "release needs --worker <id>; use force-release otherwise");
      return mutate((tx) => {
        if (checkWorker(tx, actor.id) !== key) throw new SfError("claim_gone", "claim is gone");
        endClaim(tx, key, "released");
        reconcileDependencies(tx);
        drainQueue(tx);
        return details(tx.rt, storyView(key));
      });
    },

    async forceRelease(key: string) {
      return mutate((tx) => {
        if (!tx.rt.claims[key]) throw new SfError("invalid", `${key} is not claimed`);
        endClaim(tx, key, "force-released");
        drainQueue(tx);
        return details(tx.rt, storyView(key));
      });
    },

    async retry(key: string) {
      return mutate((tx) => {
        const { rt } = tx;
        if (!rt.failures[key]) throw new SfError("invalid", `${key} has no failed spawn to retry`);
        const claim = rt.claims[key];
        if (claim) throw new SfError("claimed", `${key} is claimed by Worker ${claim.workerId}`);
        const { boardId, board, story } = locate(key);
        if (!stageSpawns(boardId, board, story.stage))
          throw new SfError("invalid", `Stage ${story.stage} has no enabled Stage Prompt`);
        const hil = activeHil(board, story);
        if (hil)
          throw new SfError("invalid", `${key} is held for HIL (${hil.flag} is true); clear it to start a Worker`);
        delete rt.failures[key];
        requestSpawn(tx, key, boardId, story.stage);
        return details(rt, view(key, boardId, story));
      });
    },

    async showStory(key: string, actor: Actor): Promise<StoryDetails> {
      if (actor.kind === "worker")
        return mutate((tx) => {
          checkWorker(tx, actor.id);
          return details(tx.rt, storyView(key));
        });
      loadProjectConfig(root);
      return details(loadRuntime(root), storyView(key));
    },

    listStories(ref?: string, stageId?: string): StoryDetails[] {
      loadProjectConfig(root);
      const rt = loadRuntime(root);
      const ids = ref ? [boardRef(ref).id] : listBoardIds(root);
      return ids
        .flatMap((id) => storyViews(id))
        .filter((s) => !stageId || s.stage === stageId)
        .map((s) => details(rt, s));
    },

    listBoards() {
      return listBoardIds(root).map((id) => ({ id, config: loadBoard(root, id) }));
    },

    showBoard(ref: string) {
      const { id, config } = boardRef(ref);
      const prompts = Object.fromEntries(config.stages.map((s) => [s.id, promptText(id, s.id)]));
      const project = loadProjectConfig(root);
      return {
        id,
        config,
        prompts,
        effectiveModel: resolveModel(project, config),
        modelOptions: modelCatalog(project, config, [
          config.overrides.worker?.model,
          ...config.stages.map((s) => s.model),
        ]),
      };
    },

    /** Ends timed-out Claims and drains the queue. */
    async sweep() {
      return mutate(() => {});
    },

    /** Runs triggers queued while no server was running. Call once the Supervisor is registered. */
    async drainPending() {
      return mutate((tx) => {
        // Discover unresolved waits after recovery, including hand edits while stopped.
        for (const story of allStories())
          if (unresolved(story).length) tx.rt.dependencyWaits[story.key] = { stageId: story.stage };
        reconcileDependencies(tx);
        const triggers = tx.rt.pendingTriggers;
        tx.rt.pendingTriggers = [];
        let index = 0;
        try {
          for (; index < triggers.length; index++) {
            const t = triggers[index]!;
            const found = tryLocate(t.storyKey);
            if (!found) continue;
            if (t.type === "cleanup") scheduleCleanup(tx, t.storyKey);
            else if (
              found.story.stage === t.stageId &&
              !tx.rt.claims[t.storyKey] &&
              spawnsFor(found.boardId, found.board, t.stageId, found.story)
            )
              requestSpawn(tx, t.storyKey, found.boardId, t.stageId);
          }
        } catch (err) {
          // Keep unfinished triggers and cleanups whose after-tasks cannot run on error.
          // Completed spawns must not be replayed after their Claims end.
          tx.rt.pendingTriggers.unshift(...triggers.filter((t, i) => i >= index || t.type === "cleanup"));
          throw err;
        }
      });
    },

    /**
     * The delivery gate, called when the Supervisor claims a `worker.spawn`.
     * Creates or reuses the Story Worktree and records the branch, then marks the
     * execution `launching` under the lock just before the command is delivered.
     * Returns "cancelled" when the reservation is no longer valid (it never
     * started), or an error to fail the spawn with (it never started either).
     */
    async prepareSpawn(workerId: string): Promise<{ ok: true } | { cancelled: true } | { error: string }> {
      // Git preparation releases the mutation lock. Check both before that work
      // and after it, immediately before the command can be delivered.
      const gate = (deliver: boolean) =>
        mutate((tx) => {
          const e = executionOf(tx.rt, workerId);
          const key = e?.storyKey;
          const claim = key && tx.rt.claims[key];
          if (e?.status !== "reserved") return null;
          if (!claim || claim.workerId !== workerId || claim.status !== "spawning") {
            finishExecution(tx, e, "not-started", "the reservation ended before delivery");
            return null;
          }
          const found = tryLocate(e.storyKey);
          const stale = !found
            ? "the Story is gone"
            : found.story.stage !== claim.stageId
              ? "the Story left the Stage"
              : !spawnsFor(found.boardId, found.board, claim.stageId, found.story)
                ? "the Stage no longer starts a Worker for this Story"
                : staleSelection(tx, e, found);
          if (stale) {
            if (found && unresolved(found.story).length)
              tx.rt.dependencyWaits[e.storyKey] = { stageId: found.story.stage };
            endClaim(tx, e.storyKey, "released");
            e.evidence = `cancelled before delivery: ${stale}`;
            // Ask again with the current settings, behind older work.
            if (found && found.story.stage === claim.stageId)
              requestSpawn(tx, e.storyKey, found.boardId, claim.stageId);
            return null;
          }
          if (deliver) {
            Object.assign(e, { status: "launching", dispatchedAt: now(), updatedAt: now() });
            delete e.intent;
          }
          return e;
        }, false);
      const e = await gate(false);
      if (!e) return { cancelled: true };
      // A remote Worker still gets its Story Worktree here, the authority-side context; the harness prepares the machine.
      try {
        await service.ensureStoryWorktree(e.storyKey, e.id);
      } catch (err) {
        return { error: `could not prepare the Story Worktree: ${(err as Error).message}` };
      }
      const delivered = await gate(true);
      if (!delivered) return { cancelled: true };
      return { ok: true };
    },

    /** Undoes delivery when the command never reached the Supervisor (its long-poll closed). */
    async undeliver(workerId: string) {
      return mutate(({ rt }) => {
        const e = executionOf(rt, workerId);
        if (e?.status === "launching" && !e.acceptedAt)
          Object.assign(e, { status: "reserved", updatedAt: now(), evidence: "the long-poll closed before delivery" });
      }, false);
    },

    /** Creates or reuses the Story Worktree. Refused while another execution occupies the branch. */
    async ensureStoryWorktree(key: string, owner?: string) {
      const { board } = locate(key);
      fence(loadRuntime(root), key, owner);
      const base = await resolveBaseBranch(git, root, resolveSettings(loadProjectConfig(root), board).baseBranch);
      const wt = await ensureWorktree(git, root, key, base);
      await mutate(() => {
        const found = locate(key);
        if (found.story.branch !== wt.branch) writeStory(found.boardId, key, { ...found.story, branch: wt.branch });
      });
      return wt;
    },

    removeWorktree,

    /**
     * The Supervisor's `done` (ok: launch accepted, never completion) or `fail`
     * for a `worker.spawn`. Applies only to the Worker's own launch generation;
     * it may attach identities after the Claim ended but never restores it.
     * A failure without structured evidence is definite only before delivery.
     */
    async spawnResult(workerId: string, ok: boolean, text?: string, report?: ExecutionReport, duplicate = false) {
      return mutate((tx) => {
        const { rt } = tx;
        const e = executionOf(rt, workerId);
        if (!e) return { applied: false, reason: "no such launch" };
        // A repeated result only contributes structured, generation-checked evidence.
        if (duplicate) return report ? applyReport(tx, e, report) : { applied: false, reason: "duplicate result" };
        if (ok && report && report.status === "not-started")
          throw new SfError("invalid", "a successful launch cannot report not-started; use fail");
        const worker = rt.workers[workerId];
        if (ok && text && worker && !worker.threadId) worker.threadId = text;
        if (ok && text && !e.label) e.label = text;
        const failedLive = !ok && claimLive(rt, e);
        const evidence = report ?? {
          ...(ok
            ? { status: "running" as const, evidence: "launch accepted" }
            : e.status === "reserved"
              ? { status: "not-started" as const, evidence: text || "spawn failed" }
              : {
                  status: "unknown" as const,
                  evidence: `launch failed without launch evidence: ${text || "spawn failed"}`,
                }),
        };
        const result = applyReport(tx, e, evidence);
        if (failedLive) {
          rt.failures[e.storyKey] = { stageId: e.stageId, error: text || "spawn failed", at: now() };
          endClaim(tx, e.storyKey, "spawn-failed");
          drainQueue(tx);
        }
        return result;
      });
    },

    /** The Supervisor's answer to an `execution.reconcile` or `execution.cancel`. */
    async attemptResult(
      command: ExecutionReconcileCommand | (Omit<ExecutionReconcileCommand, "type"> & { type: "execution.cancel" }),
      ok: boolean,
      text?: string,
      report?: ExecutionReport,
    ) {
      return mutate((tx) => {
        const e = tx.rt.executions[command.execution.id];
        if (!e) return { applied: false, reason: "no such execution" };
        if (e.attempt?.id !== command.attemptId) {
          // A stale answer changes nothing; a mismatched identity is still rejected.
          if (report) applyReport(tx, e, { ...report, attemptId: command.attemptId });
          return { applied: false, reason: `attempt ${command.attemptId} is not outstanding` };
        }
        if (!ok && !report) {
          e.evidence = `${e.attempt.kind} failed: ${text || "no reason"}`;
          completeAttempt(e);
          return { applied: true };
        }
        return applyReport(tx, e, {
          ...(report ?? { status: "unknown", evidence: text || "no structured status reported" }),
          attemptId: command.attemptId,
        });
      });
    },

    /** Correlated evidence about an execution, from the Supervisor or an operator through it. */
    async reportExecution(id: string, report: ExecutionReport) {
      return mutate((tx) => {
        const e = tx.rt.executions[id];
        if (!e) throw new SfError("not_found", `no execution ${id}`);
        const result = applyReport(tx, e, report);
        return { ...result, execution: executionView(tx.rt, e) };
      });
    },

    /** Asks the Supervisor to look the execution up now. Never relaunches it. */
    async requestReconcile(id: string) {
      return requestAttempt(id, "reconcile");
    },

    /** Asks the Supervisor to stop the execution. Its capacity is freed only on terminal evidence. */
    async requestCancel(id: string) {
      return requestAttempt(id, "cancel");
    },

    /**
     * Startup recovery: reconnects the outbox with the Supervisor's command
     * records. Undelivered launches are republished under the same identity;
     * delivered ones without a result become `unknown`.
     */
    async recover() {
      // Without command records there is nothing to reconnect with.
      if (!boundary.commandState) return;
      return mutate(({ rt }) => {
        for (const e of Object.values(rt.executions)) {
          if (!occupies(e)) continue;
          const state = e.commandId ? boundary.commandState?.(e.commandId) : undefined;
          if (e.status === "reserved" && e.commandId && state !== "pending") delete e.commandId;
          if (e.status === "launching") {
            if (e.migrated && state === "pending") Object.assign(e, { status: "reserved", updatedAt: now() });
            else
              Object.assign(e, {
                status: "unknown",
                updatedAt: now(),
                evidence: "sf restarted after delivering the launch command and before its result",
              });
          }
          if (e.attempt?.commandId) {
            const attempt = boundary.commandState?.(e.attempt.commandId);
            if (attempt !== "pending" && attempt !== "claimed") delete e.attempt;
          }
        }
      }, false);
    },

    executions(): ExecutionsResponse {
      loadProjectConfig(root);
      const rt = loadRuntime(root);
      return {
        identity: rt.identity,
        support: boundary.support(),
        usage: usageOf(rt),
        executions: Object.values(rt.executions)
          .sort((a, b) => Number(occupies(b)) - Number(occupies(a)) || b.createdAt - a.createdAt)
          .map((e) => executionView(rt, e)),
      };
    },

    showExecution(id: string): ExecutionView {
      loadProjectConfig(root);
      const rt = loadRuntime(root);
      const e = rt.executions[id];
      if (!e) throw new SfError("not_found", `no execution ${id}`);
      return executionView(rt, e);
    },

    snapshot(): ProjectSnapshot | null {
      if (!fs.existsSync(paths.config)) return null;
      return {
        root,
        config: loadProjectConfig(root),
        boards: listBoardIds(root).map((id) => ({ ...service.showBoard(id), stories: storyViews(id) })),
        runtime: loadRuntime(root),
      };
    },
  };
  return service;

  function storyView(key: string) {
    const { boardId, story } = locate(key);
    return view(key, boardId, story);
  }
}

function mergeOptions(existing: import("#model/models").ModelOption[] | undefined, additions: unknown) {
  return [...new Map([...(existing ?? []), ...normalizeModelOptions(additions)].map((o) => [o.slug, o])).values()];
}

function checkStoryModel(board: BoardConfig, model: unknown, fields?: Record<string, unknown>) {
  if (model !== undefined && board.schema.some((f) => f.id === "model"))
    throw new SfError(
      "invalid",
      "legacy custom field model conflicts with the built-in model; rename it and its data first",
    );
  if (fields && Object.hasOwn(fields, "model"))
    throw new SfError("invalid", "model is a built-in property; use --model instead of custom fields");
}

// The one library every Story change goes through: HTTP routes (UI, Supervisor,
// Workers) when the server is up, and the CLI directly when it is not.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { StoryDetails, UpdateProjectRequest } from "#model/api";
import type { AttachmentInput, AttachmentSubmission } from "#model/attachment";
import { activeHil, type BoardConfig, type BoardOverrides, type FieldDef, type ProjectConfig } from "#model/config";
import { modelCatalog, resolveModel } from "#model/models";
import type { ProjectSnapshot, StoryView } from "#model/project";
import type { RuntimeState, WorkerEndReason } from "#model/runtime";
import { attachmentStore } from "./attachments.ts";
import { composeBrief } from "./brief.ts";
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
import { nextStoryNumber, parseStory, parseStoryKey, type StoryData, serializeStory, validateFields } from "./story.ts";
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

export type SpawnRequest = {
  workerId: string;
  storyKey: string;
  board: string;
  stageId: string;
  mode: "thread" | "subagent";
  agent?: string;
  model?: string;
  worktree: { path: string; branch: string };
  brief: string;
};

export type ServiceOptions = {
  root: string;
  /** True inside the server. Offline, spawns and cleanups become pending triggers. */
  online: boolean;
  now?: () => number;
  git?: Git;
  /** Online: queues a `worker.spawn` command and returns its id. */
  onSpawn?: (request: SpawnRequest) => string;
  /** How new Workers run, from the Supervisor's capabilities. */
  spawnMode?: () => "thread" | "subagent";
  /** Shell-ready sf command for Worker Briefs. */
  sf?: string;
  /** Called after every mutation. */
  onChange?: () => void;
};

export type StoryInput = AttachmentSubmission & {
  model?: string | null;
  title: string;
  stage?: string;
  fields?: Record<string, unknown>;
  body?: string;
};
export type StoryPatch = AttachmentSubmission & {
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
    return stageSpawns(boardId, board, stageId) && !activeHil(board, { ...story, stage: stageId });
  }

  function view(key: string, boardId: string, story: StoryData): StoryView {
    return {
      key,
      board: boardId,
      title: story.title,
      stage: story.stage,
      ...(story.branch ? { branch: story.branch } : {}),
      ...(story.model ? { model: story.model } : {}),
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
    if (rt.queue.some((q) => q.storyKey === v.key)) d.queued = true;
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

  async function mutate<T>(fn: (tx: Tx) => T, drain = true): Promise<T> {
    loadProjectConfig(root);
    const after: Tx["after"] = [];
    let result: T;
    try {
      result = await withLock(root, () => {
        const tx: Tx = { rt: loadRuntime(root), project: loadProjectConfig(root), after };
        try {
          sweep(tx);
          if (drain) drainQueue(tx);
          return fn(tx);
        } finally {
          saveRuntime(root, tx.rt);
        }
      });
    } finally {
      opts.onChange?.();
    }
    for (const task of after) await task();
    return result;
  }

  function endClaim(tx: Tx, key: string, reason: WorkerEndReason) {
    const claim = tx.rt.claims[key];
    if (!claim) return;
    delete tx.rt.claims[key];
    const worker = tx.rt.workers[claim.workerId];
    if (worker) Object.assign(worker, { endedAt: now(), endReason: reason });
  }

  /** Ends Claims whose Worker ran no sf command for the claim timeout. */
  function sweep(tx: Tx) {
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

  function liveClaims(tx: Tx) {
    return Object.keys(tx.rt.claims).length;
  }

  /** Starts queued spawns, oldest first, while there is capacity. */
  function drainQueue(tx: Tx) {
    if (!online) return;
    while (tx.rt.queue.length && liveClaims(tx) < tx.project.maxConcurrentWorkers) {
      const entry = tx.rt.queue.shift()!;
      const found = tryLocate(entry.storyKey);
      if (!found || tx.rt.claims[entry.storyKey] || found.story.stage !== entry.stageId) continue;
      if (!spawnsFor(found.boardId, found.board, entry.stageId, found.story)) continue;
      try {
        spawnNow(tx, entry.storyKey, found.boardId, entry.stageId);
      } catch (err) {
        // Runtime is saved even on error; keep this spawn first for the next drain.
        tx.rt.queue.unshift(entry);
        throw err;
      }
    }
  }

  function requestSpawn(tx: Tx, key: string, boardId: string, stageId: string) {
    const { rt } = tx;
    rt.queue = rt.queue.filter((q) => q.storyKey !== key);
    if (!online) {
      rt.pendingTriggers = rt.pendingTriggers.filter((t) => !(t.type === "spawn" && t.storyKey === key));
      rt.pendingTriggers.push({ type: "spawn", storyKey: key, stageId, at: now() });
      return;
    }
    if (liveClaims(tx) >= tx.project.maxConcurrentWorkers) {
      rt.queue.push({ storyKey: key, board: boardId, stageId, queuedAt: now() });
      return;
    }
    spawnNow(tx, key, boardId, stageId);
  }

  function spawnNow(tx: Tx, key: string, boardId: string, stageId: string) {
    const { board, story } = locate(key);
    const stage = board.stages.find((s) => s.id === stageId)!;
    const settings = resolveSettings(tx.project, board, stage, story);
    const workerId = `w-${crypto.randomBytes(4).toString("hex")}`;
    const worktree = { path: worktreePath(root, key), branch: storyBranch(key) };
    const mode = opts.spawnMode?.() ?? "subagent";
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
    });
    const commandId = opts.onSpawn?.({
      workerId,
      storyKey: key,
      board: boardId,
      stageId,
      mode,
      ...(settings.agent ? { agent: settings.agent } : {}),
      ...(settings.model ? { model: settings.model } : {}),
      worktree,
      brief,
    });
    const t = now();
    tx.rt.claims[key] = {
      workerId,
      board: boardId,
      stageId,
      status: "spawning",
      claimedAt: t,
      lastSeenAt: t,
      ...(commandId ? { commandId } : {}),
    };
    tx.rt.workers[workerId] = { storyKey: key, stageId, mode, startedAt: t };
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

  function scheduleCleanup(tx: Tx, key: string) {
    if (online) tx.after.push(() => removeWorktree(key, false, true));
    else tx.rt.pendingTriggers.push({ type: "cleanup", storyKey: key, at: now() });
  }

  /** What follows a Story entering a Stage (a Move or a create). A Story held for HIL waits. */
  function enterStage(tx: Tx, key: string, boardId: string, board: BoardConfig, story: StoryData, claimEnded: boolean) {
    const stageId = story.stage;
    if (stageId === DONE) scheduleCleanup(tx, key);
    if (claimEnded && online) {
      // Persist this Story's intent before a drain can fail, behind older spawns.
      if (spawnsFor(boardId, board, stageId, story))
        tx.rt.queue.push({ storyKey: key, board: boardId, stageId, queuedAt: now() });
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
    return Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== null && v !== undefined));
  }

  /** Removes the Story Worktree; for a Story in Done, also deletes its branch once merged. */
  async function removeWorktree(key: string, force: boolean, onlyIfDone = false): Promise<CleanupResult> {
    // Serialize the existence check and git operation with deletion. A deferred
    // Done cleanup must never remove artifacts after its Story has been deleted.
    const result = await withLock(root, async (): Promise<CleanupResult> => {
      const found = tryLocate(key);
      if (!found && onlyIfDone) return { removed: false, path: worktreePath(root, key), branch: storyBranch(key) };
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
    await mutate(({ rt }) => {
      if (!tryLocate(key)) return;
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
        validateModel(input.model);
        checkStoryModel(config, input.model, input.fields);
        const fields = cleanFields(input.fields ?? {});
        validateFields(config.schema, fields);
        const number = Math.max(config.storyNumber ?? 0, nextStoryNumber(paths.stories(id), config.key) - 1) + 1;
        config.storyNumber = number;
        // Reserve the Key before writing: a failed write may leave a gap, never a reused Key.
        saveBoard(root, id, config);
        const key = `${config.key}-${number}`;
        const story: StoryData = {
          title,
          stage: stageId,
          ...(input.model ? { model: input.model } : {}),
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
          title: patch.title?.trim() ?? story.title,
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
        if (wasHeld && !held && !tx.rt.claims[key] && stageSpawns(boardId, board, next.stage))
          requestSpawn(tx, key, boardId, next.stage);
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
        if (claim) endClaim(tx, key, "moved");
        enterStage(tx, key, boardId, board, next, Boolean(claim));
        return details(rt, view(key, boardId, next));
      });
    },

    async releaseStory(key: string, actor: Actor) {
      if (actor.kind !== "worker")
        throw new SfError("invalid", "release needs --worker <id>; use force-release otherwise");
      return mutate((tx) => {
        if (checkWorker(tx, actor.id) !== key) throw new SfError("claim_gone", "claim is gone");
        endClaim(tx, key, "released");
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
     * Called when the Supervisor claims a `worker.spawn`. Creates or reuses the
     * Story Worktree and records the branch. Returns "cancelled" if the Claim is
     * gone, or an error to fail the spawn with.
     */
    async prepareSpawn(workerId: string): Promise<{ ok: true } | { cancelled: true } | { error: string }> {
      // Read under the lock so a transaction that is still enqueuing this spawn has saved its Claim.
      const rt = await withLock(root, () => loadRuntime(root));
      const key = rt.workers[workerId]?.storyKey;
      if (!key || rt.claims[key]?.workerId !== workerId) return { cancelled: true };
      try {
        await service.ensureStoryWorktree(key);
        return { ok: true };
      } catch (err) {
        return { error: `could not prepare the Story Worktree: ${(err as Error).message}` };
      }
    },

    async ensureStoryWorktree(key: string) {
      const { board } = locate(key);
      const base = await resolveBaseBranch(git, root, resolveSettings(loadProjectConfig(root), board).baseBranch);
      const wt = await ensureWorktree(git, root, key, base);
      await mutate(() => {
        const found = locate(key);
        if (found.story.branch !== wt.branch) writeStory(found.boardId, key, { ...found.story, branch: wt.branch });
      });
      return wt;
    },

    removeWorktree,

    /** The Supervisor's `done` (ok) or `fail` for a `worker.spawn`. */
    async spawnResult(workerId: string, ok: boolean, text?: string) {
      return mutate((tx) => {
        const { rt } = tx;
        const worker = rt.workers[workerId];
        const claim = worker && rt.claims[worker.storyKey];
        if (!worker || !claim || claim.workerId !== workerId) return;
        if (ok) {
          Object.assign(claim, { status: "active", lastSeenAt: now() });
          if (text) worker.threadId = text;
          return;
        }
        endClaim(tx, worker.storyKey, "spawn-failed");
        rt.failures[worker.storyKey] = { stageId: claim.stageId, error: text || "spawn failed", at: now() };
        drainQueue(tx);
      });
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

// Project subcommands (init, board, stage, story, worktree). They call the
// server's HTTP routes when it is running and the Story service directly when
// it is not, so every Story change goes through the same library.
import fs from "node:fs";
import {
  routes,
  type BoardResponse,
  type ProjectConfig,
  type ProjectSnapshot,
  type StageConfig,
  type StoryDetails,
  type WorktreeResponse,
} from "#protocol";
import { api, type ServerInfo } from "../server/client.ts";
import { SfError } from "../server/project/errors.ts";
import { createService, type Actor } from "../server/project/service.ts";
import { parseFieldArg, parseStoryKey } from "../server/project/story.ts";

export type Flags = Record<string, string | boolean | string[]>;

export const PROJECT_COMMANDS = new Set(["init", "board", "stage", "story", "worktree"]);

export const PROJECT_HELP = `Project commands (all accept --project <dir>, --json; Workers add --worker <id>):
  sf-factory init
  sf-factory board list | create <name> --key <KEY> | show <board>
  sf-factory stage add <board> <name> [--after <stage-id>]
  sf-factory stage set <board> <stage-id> [--name <n>] [--prompt-enabled true|false]
                       [--prompt <text> | --prompt-file <path>] [--agent <a>] [--model <m>]
  sf-factory stage reorder <board> <stage-id> --index <n>
  sf-factory stage remove <board> <stage-id>
  sf-factory story create <board> --title "<t>" [--stage <id>] [--field k=v]... [--body "<md>" | --body-file <p>]
  sf-factory story list [<board>] [--stage <id>]
  sf-factory story show <KEY>
  sf-factory story move <KEY> <stage-id>
  sf-factory story update <KEY> [--title "<t>"] [--field k=v]... [--body "<md>" | --body-file <p>]
  sf-factory story release <KEY>
  sf-factory story force-release <KEY>
  sf-factory story retry <KEY>
  sf-factory worktree ensure <KEY> | remove <KEY> [--force]
<board> is a Board id or key. Exit codes: 0 ok, 1 error, 3 rejected (claim is gone, or claimed).`;

export async function runProjectCommand(cmd: string, args: string[], flags: Flags, root: string, server: ServerInfo | null) {
  const svc = createService({ root, online: false });
  const workerId = str(flags.worker);
  const actor: Actor = workerId ? { kind: "worker", id: workerId } : { kind: "user" };
  const sub = args[0];
  const call = <T>(method: string, route: string, body: unknown, offline: () => T | Promise<T>): Promise<T> =>
    server ? api<T>(server, method, route, body) : Promise.resolve(offline());
  const out = (value: unknown, text: () => string) => console.log(flags.json ? JSON.stringify(value, null, 2) : text());
  const need = (value: string | undefined, usage: string) => {
    if (!value) throw new SfError("invalid", `usage: sf-factory ${usage}`);
    return value;
  };

  switch (cmd) {
    case "init": {
      const config = await call<ProjectConfig>("POST", routes.projectInit, {}, () => svc.init());
      return out(config, () => `Initialized sf Project at ${root}/.sf`);
    }

    case "board": {
      if (sub === "list") {
        const boards = server
          ? ((await api<ProjectSnapshot | null>(server, "GET", routes.project))?.boards ?? [])
          : svc.hasProject()
            ? svc.listBoards()
            : [];
        return out(boards, () =>
          boards.length
            ? boards.map((b) => `${b.id.padEnd(20)} ${b.config.key.padEnd(6)} ${b.config.name}`).join("\n")
            : "No Boards.",
        );
      }
      if (sub === "create") {
        const name = need(args.slice(1).join(" "), "board create <name> --key <KEY>");
        const key = need(str(flags.key), "board create <name> --key <KEY>");
        const board = await call<BoardResponse>("POST", routes.boards, { name, key }, () => svc.createBoard(name, key));
        return out(board, () => `Created Board ${board.id} (${board.config.key}).\n${formatStages(board.config.stages)}`);
      }
      if (sub === "show") {
        const ref = need(args[1], "board show <board>");
        const board = await call<BoardResponse>("GET", routes.board(ref), undefined, () => svc.showBoard(ref));
        return out(board, () => formatBoard(board));
      }
      throw new SfError("invalid", "usage: sf-factory board list | create <name> --key <KEY> | show <board>");
    }

    case "stage": {
      const usage = "stage add|set|reorder|remove <board> ...";
      const ref = need(args[1], usage);
      if (sub === "add") {
        const name = need(args.slice(2).join(" "), "stage add <board> <name> [--after <stage-id>]");
        const after = str(flags.after);
        const stage = await call<StageConfig>("POST", routes.stages(ref), { name, after }, () => svc.addStage(ref, name, after));
        return out(stage, () => `Added Stage ${stage.id} (${stage.name}).`);
      }
      const stageId = need(args[2], usage);
      if (sub === "set") {
        const patch: Record<string, unknown> = {};
        if (str(flags.name) !== undefined) patch.name = str(flags.name);
        if (flags["prompt-enabled"] !== undefined) patch.promptEnabled = bool(flags["prompt-enabled"]);
        if (str(flags["prompt-file"])) patch.prompt = fs.readFileSync(str(flags["prompt-file"])!, "utf8");
        else if (str(flags.prompt) !== undefined) patch.prompt = str(flags.prompt);
        for (const k of ["agent", "model"]) if (flags[k] !== undefined) patch[k] = str(flags[k]) || null;
        const stage = await call<StageConfig & { prompt: string }>("PATCH", routes.stage(ref, stageId), patch, () =>
          svc.updateStage(ref, stageId, patch),
        );
        return out(stage, () => `Stage ${stage.id}: ${stage.name}, prompt ${stage.promptEnabled ? "enabled" : "disabled"}` +
          `${stage.prompt.trim() ? "" : " (no prompt text)"}.`);
      }
      if (sub === "reorder") {
        const index = Number(need(str(flags.index), "stage reorder <board> <stage-id> --index <n>"));
        const stages = await call<StageConfig[]>("POST", routes.stageReorder(ref, stageId), { index }, () =>
          svc.reorderStage(ref, stageId, index),
        );
        return out(stages, () => formatStages(stages));
      }
      if (sub === "remove") {
        const stages = await call<StageConfig[]>("DELETE", routes.stage(ref, stageId), undefined, () => svc.removeStage(ref, stageId));
        return out(stages, () => formatStages(stages));
      }
      throw new SfError("invalid", `usage: sf-factory ${usage}`);
    }

    case "story": {
      if (sub === "list") {
        const ref = args[1];
        const stage = str(flags.stage);
        const query = new URLSearchParams({ ...(ref ? { board: ref } : {}), ...(stage ? { stage } : {}) });
        const stories = await call<StoryDetails[]>("GET", `${routes.stories}?${query}`, undefined, () => svc.listStories(ref, stage));
        return out(stories, () => (stories.length ? stories.map(formatStoryLine).join("\n") : "No Stories."));
      }
      if (sub === "create") {
        const ref = need(args[1], 'story create <board> --title "<t>"');
        const schema = svc.showBoard(ref).config.schema;
        const body = {
          board: ref,
          title: need(str(flags.title), 'story create <board> --title "<t>"'),
          ...(str(flags.stage) ? { stage: str(flags.stage) } : {}),
          fields: parseFields(schema, flags.field),
          ...readBody(flags),
          ...(workerId ? { worker: workerId } : {}),
        };
        const story = await call<StoryDetails>("POST", routes.stories, body, () => svc.createStory(ref, body, actor));
        return out(story, () => `Created ${story.key} in ${story.stage}.${statusText(story)}`);
      }
      const key = need(args[1], `story ${sub ?? "<command>"} <KEY>`);
      const worker = workerId ? { worker: workerId } : {};
      if (sub === "show") {
        const route = `${routes.story(key)}${workerId ? `?worker=${encodeURIComponent(workerId)}` : ""}`;
        const story = await call<StoryDetails>("GET", route, undefined, () => svc.showStory(key, actor));
        return out(story, () => formatStory(story));
      }
      if (sub === "move") {
        const stage = need(args[2], "story move <KEY> <stage-id>");
        const story = await call<StoryDetails>("POST", routes.storyMove(key), { stage, ...worker }, () =>
          svc.moveStory(key, stage, actor),
        );
        return out(story, () => `Moved ${key} to ${story.stage}.${statusText(story)}`);
      }
      if (sub === "update") {
        const boardKey = parseStoryKey(key)?.boardKey ?? key;
        const patch = {
          ...(str(flags.title) !== undefined ? { title: str(flags.title) } : {}),
          ...(flags.field ? { fields: parseFields(svc.showBoard(boardKey).config.schema, flags.field) } : {}),
          ...readBody(flags),
        };
        const story = await call<StoryDetails>("PATCH", routes.story(key), { ...patch, ...worker }, () =>
          svc.updateStory(key, patch, actor),
        );
        return out(story, () => `Updated ${key}.`);
      }
      if (sub === "release") {
        const story = await call<StoryDetails>("POST", routes.storyRelease(key), worker, () => svc.releaseStory(key, actor));
        return out(story, () => `Released ${key}.`);
      }
      if (sub === "force-release") {
        const story = await call<StoryDetails>("POST", routes.storyForceRelease(key), {}, () => svc.forceRelease(key));
        return out(story, () => `Force-released ${key}.${statusText(story)}`);
      }
      if (sub === "retry") {
        const story = await call<StoryDetails>("POST", routes.storyRetry(key), {}, () => svc.retry(key));
        return out(story, () => `Retrying ${key} in ${story.stage}.${statusText(story)}`);
      }
      throw new SfError("invalid", "usage: sf-factory story list|create|show|move|update|release|force-release|retry");
    }

    case "worktree": {
      const key = need(args[1], "worktree ensure|remove <KEY>");
      if (sub === "ensure") {
        const wt = await call<WorktreeResponse>("POST", routes.storyWorktree(key), { action: "ensure" }, () =>
          svc.ensureStoryWorktree(key),
        );
        return out(wt, () => `Worktree for ${key}: ${wt.path} (branch ${wt.branch})`);
      }
      if (sub === "remove") {
        const force = Boolean(flags.force);
        const wt = await call<WorktreeResponse>("POST", routes.storyWorktree(key), { action: "remove", force }, () =>
          svc.removeWorktree(key, force),
        );
        return out(wt, () =>
          wt.removed ? `Removed ${wt.path} (kept branch ${wt.branch}).` : wt.reason ? `Kept ${wt.path}: ${wt.reason}.` : `No worktree for ${key}.`,
        );
      }
      throw new SfError("invalid", "usage: sf-factory worktree ensure|remove <KEY> [--force]");
    }
  }
}

// ---------- formatting ----------

function formatStages(stages: StageConfig[]) {
  return stages
    .map((s, i) => `  ${i}. ${s.id.padEnd(16)} ${s.name}${s.promptEnabled ? "  [prompt enabled]" : ""}${s.agent ? `  agent=${s.agent}` : ""}${s.model ? `  model=${s.model}` : ""}`)
    .join("\n");
}

function formatBoard({ id, config, prompts }: BoardResponse) {
  const lines = [`${config.name} (key ${config.key}, id ${id})`, "Stages:", formatStages(config.stages)];
  if (config.schema.length) {
    lines.push("Fields:");
    for (const f of config.schema) lines.push(`  ${f.id} (${f.type}${f.options ? `: ${f.options.join(", ")}` : ""}) ${f.name}`);
  }
  for (const [stage, text] of Object.entries(prompts ?? {})) if (text.trim()) lines.push(`Prompt for ${stage}:`, indent(text.trim()));
  return lines.join("\n");
}

function statusText(s: StoryDetails) {
  if (s.claim) return ` Claimed by Worker ${s.claim.workerId} (${s.claim.status}).`;
  if (s.queued) return " Waiting for a Worker.";
  if (s.failure) return ` Spawn failed: ${s.failure.error}`;
  return "";
}

function formatStoryLine(s: StoryDetails) {
  const tags = [
    s.claim && `claimed by ${s.claim.workerId} (${s.claim.status})`,
    s.queued && "waiting for a Worker",
    s.failure && `failed: ${s.failure.error}`,
    s.worktreeWarning && `worktree kept: ${s.worktreeWarning.reason}`,
  ].filter(Boolean);
  return `${s.key.padEnd(8)} ${s.stage.padEnd(14)} ${s.title}${tags.length ? `  [${tags.join("; ")}]` : ""}`;
}

function formatStory(s: StoryDetails) {
  const lines = [`${s.key}: ${s.title}`, `stage: ${s.stage}`];
  if (s.branch) lines.push(`branch: ${s.branch}`);
  for (const [k, v] of Object.entries(s.fields)) lines.push(`${k}: ${Array.isArray(v) ? v.join(", ") : String(v)}`);
  const status = statusText(s).trim();
  if (status) lines.push(status);
  if (s.worktreeWarning) lines.push(`Worktree kept at ${s.worktreeWarning.path}: ${s.worktreeWarning.reason}`);
  if (s.body.trim()) lines.push("", s.body.trim());
  return lines.join("\n");
}

function indent(text: string) {
  return text.replace(/^/gm, "    ");
}

// ---------- flags ----------

function parseFields(schema: Parameters<typeof parseFieldArg>[0], value: Flags[string] | undefined) {
  const list = value === undefined ? [] : Array.isArray(value) ? value : [String(value)];
  return Object.fromEntries(list.map((arg) => parseFieldArg(schema, arg)));
}

function readBody(flags: Flags): { body?: string } {
  if (str(flags["body-file"])) return { body: fs.readFileSync(str(flags["body-file"])!, "utf8") };
  if (str(flags.body) !== undefined) return { body: str(flags.body) };
  return {};
}

function str(v: Flags[string] | undefined): string | undefined {
  return typeof v === "string" ? v : Array.isArray(v) ? v.at(-1) : undefined;
}

function bool(v: Flags[string]) {
  const s = str(v);
  if (v === true || s === "true") return true;
  if (s === "false") return false;
  throw new SfError("invalid", `expected true or false, got ${JSON.stringify(v)}`);
}

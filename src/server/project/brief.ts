import type { MachineRequest } from "#model/commands";
import type { BoardConfig, FieldDef, SchedulingConfig } from "#model/config";
import { modelDescription, type ResolvedModel } from "#model/models";
import type { StoryPlacement } from "#model/placement";
import type { StoryData } from "./story.ts";

export type BriefInput = {
  effectiveModel?: ResolvedModel;
  storyKey: string;
  story: StoryData;
  boardId: string;
  board: BoardConfig;
  stageId: string;
  root: string;
  worktree: { path: string; branch: string };
  workerId: string;
  /** Shell-ready command that runs sf, e.g. `sf` or `node /abs/sf.mjs`. */
  sf: string;
  preamble: string;
  prompt: string;
  projectInstructions?: string;
  boardInstructions?: string;
  /** The requested remote machine; its instructions end the brief. */
  machine?: MachineRequest;
};

/** The Worker Brief: sf/configured preambles, project/board instructions, Stage Prompt, Story. */
export function composeBrief(b: BriefInput): string {
  const tail = `--worker ${b.workerId} --project ${shellQuote(b.root)}`;
  const stages = b.board.stages
    .map(
      (s) =>
        `- \`${s.id}\`: ${s.name}${s.id === b.stageId ? " (current)" : ""}${s.promptEnabled ? " [has a Worker]" : ""}`,
    )
    .join("\n");
  const sections = [
    `# sf Worker Brief: ${b.storyKey}

You are an sf Worker for Story ${b.storyKey} on Board "${b.board.name}" (key ${b.board.key}, id ${b.boardId}).
Your worker id is ${b.workerId}. You hold the Claim on ${b.storyKey}: no one else can Move it until you Move or release it.

- Dependencies: ${b.story.dependsOn?.join(", ") || "none"}
- Worker model: ${modelDescription(b.effectiveModel ?? { model: null, source: "supervisor" })}
- Project (the Supervisor's checkout): ${b.root}
- Your Story Worktree: ${b.worktree.path} (branch ${b.worktree.branch}). Do all work there.

Stages:
${stages}

Change Stories only with these commands. Never edit files under \`.sf\` in your worktree.

- Move this Story when your Stage's work is done (this ends your Claim):
  ${b.sf} story move ${b.storyKey} <stage-id> ${tail}
- Update this Story's title, fields, or description:
  ${b.sf} story update ${b.storyKey} [--title "<t>"] [--field <id>=<value>]... [--body-file <path>] ${tail}
- Create a new Story:
  ${b.sf} story create ${b.board.key} --title "<t>" [--stage <stage-id>] [--field <id>=<value>]... [--body-file <path>] ${tail}
- Show this Story:
  ${b.sf} story show ${b.storyKey} ${tail}
- List this Story's attachments:
  ${b.sf} story attachment list ${b.storyKey} ${tail}
- Upload one local file (up to 20 MiB):
  ${b.sf} story attachment add ${b.storyKey} <path> ${tail}
- Retrieve an attachment to a new file:
  ${b.sf} story attachment get ${b.storyKey} <attachment-id> --output <path> ${tail}
- Wait on Story dependencies and release the Claim atomically (does not set HIL):
  ${b.sf} story wait ${b.storyKey} --depends-on <KEY,KEY> ${tail}
- Set/replace dependencies with story update --depends-on <KEY,KEY>; use --depends-on "" to clear them.
- Release the Claim if you finish without Moving the Story:
  ${b.sf} story release ${b.storyKey} ${tail}

At the start, show this Story and reread its prerequisites and delivered changes. Reconcile the current Stage's work before advancing. Completing dependencies wakes this Stage; it never advances the Story automatically.

For observable Story dependencies, save your work and use story wait. sf resumes this Stage when every prerequisite is Done, subject to HIL and Worker capacity. An already-Done prerequisite may resume it immediately. Reserve HIL for a specific human decision or action (such as access, scope, or configuration); dependency completion never clears HIL.

Every command refreshes your Claim. If a command fails with "claim is gone", stop: your Claim ended and this Story is no longer yours.`,
  ];
  const hil = b.board.stages.find((s) => s.id === b.stageId)?.hil;
  // Part of the sf preamble.
  if (hil)
    sections[0] +=
      `\n\nIf you need a human, set this Stage's HIL flag${hil.comment ? " and comment" : ""}, then release the Story; no Worker runs on it here until a human clears the flag:\n` +
      `  ${b.sf} story update ${b.storyKey} --field ${hil.flag}=true${hil.comment ? ` --field "${hil.comment}=<what you need>"` : ""} ${tail}`;
  if (b.preamble.trim()) sections.push(b.preamble.trim());
  if (b.projectInstructions?.trim()) sections.push(`## SF.md\n\n${b.projectInstructions.trim()}`);
  if (b.boardInstructions?.trim()) sections.push(`## BOARD.md\n\n${b.boardInstructions.trim()}`);
  sections.push(`## Stage Prompt\n\n${b.prompt.trim()}`);
  sections.push(`## Story\n\n${storyText(b.storyKey, b.story, b.board.schema)}`);
  if (b.machine) sections.push(b.machine.instructions);
  return `${sections.join("\n\n")}\n`;
}

/**
 * The machine request for a Worker that placement put on a configured remote,
 * or undefined for local. sf asks the harness to start the Worker there and
 * leaves machine handling, preparation and Story command access to it.
 */
export function machineRequest(
  scheduling: SchedulingConfig | undefined,
  placement: StoryPlacement | undefined,
  machineId: string,
  branch: string,
): MachineRequest | undefined {
  const remote = scheduling?.remotes.find((r) => r.id === machineId);
  if (!remote) return undefined;
  const intent = placement?.mode === "required" || placement?.mode === "preferred" ? placement.mode : "default";
  const localFallback = intent !== "required" && scheduling!.order.includes("local");
  const where = `"${remote.name}" (machine id \`${remote.id}\`)`;
  const instructions = `## Machine Placement

<!-- sf:machine-placement -->
sf placement selected machine ${where} for this Worker. Start this Worker on that machine using the harness's own machine handling. sf does not move the Worker itself.

- Machine name: ${remote.name}
- Machine id: ${remote.id}
- Environment id: ${remote.environmentId}
- Project id: ${remote.project.projectId}
- Repository: ${remote.project.repository} (Story branch ${branch})
- Placement: ${
    intent === "required"
      ? "required. Do not start this Worker anywhere else. If the harness cannot start it on this machine, start nothing and report the launch as not started."
      : `${intent === "preferred" ? "preferred by the Story" : "chosen by the Project's machine order"}. ${
          localFallback
            ? "If the harness cannot start it on this machine, it may start the Worker on the Supervisor's machine instead; say where it started."
            : "The policy does not allow local fallback: if the harness cannot start it on this machine, start nothing and report the launch as not started."
        }`
  }
- The Project and Story Worktree paths in this brief are on the Supervisor's machine, which holds the sf authority. They may not exist on ${remote.name}. Preparing the machine (repository, Story branch, working directory) and reaching sf's Story commands from it are up to the harness.
- This request is not evidence that the Worker runs on ${remote.name}. Report only what the launch tool returns.
<!-- /sf:machine-placement -->`;
  return {
    id: remote.id,
    name: remote.name,
    environmentId: remote.environmentId,
    projectId: remote.project.projectId,
    repository: remote.project.repository,
    placement: intent,
    localFallback,
    instructions,
  };
}

function storyText(key: string, story: StoryData, schema: FieldDef[]) {
  const lines = [`### ${key}: ${story.title}`];
  for (const [id, value] of Object.entries(story.fields)) {
    if (value === undefined || value === null) continue;
    const name = schema.find((f) => f.id === id)?.name ?? id;
    lines.push(`- ${name}: ${Array.isArray(value) ? value.join(", ") : String(value)}`);
  }
  if (story.body.trim()) lines.push("", story.body.trim());
  return lines.join("\n");
}

export function shellQuote(arg: string) {
  return /^[\w@%+=:,./-]+$/.test(arg) ? arg : `'${arg.replace(/'/g, "'\\''")}'`;
}

import type { BoardConfig, FieldDef } from "#model/config";
import type { StoryData } from "./story.ts";

export type BriefInput = {
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
- Release the Claim if you finish without Moving the Story:
  ${b.sf} story release ${b.storyKey} ${tail}

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
  return `${sections.join("\n\n")}\n`;
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

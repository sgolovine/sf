import path from "node:path";
import { parseArgs } from "node:util";
import { cancel, intro, isCancel, log, multiselect, outro, select } from "@clack/prompts";
import { AGENTS, installSkill, OPTIONAL_SKILLS, PRIMARY_SKILL, type Scope, type Skill } from "./targets.ts";

const HELP = `Usage: sf setup [options]

Installs the sf skill (instructions for the \`sf\` CLI) for your coding agents.
Prompts for anything not given as a flag. Pass --yes to never prompt.

Options:
  --agents <ids>        comma-separated: ${AGENTS.map((a) => a.id).join(", ")}
  --scope <scope>       global (home directory) or project (default: global)
  --project-dir <dir>   project root for --scope project (default: current directory)
  --optional <names>    comma-separated optional skills, or "none"
  -y, --yes             non-interactive: use defaults for anything not given
  -h, --help            show this help`;

/** `sf setup`: installs the sf skill for coding agents. */
export async function runSetup(argv: string[]) {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      agents: { type: "string" },
      scope: { type: "string" },
      "project-dir": { type: "string" },
      optional: { type: "string" },
      yes: { type: "boolean", short: "y" },
      help: { type: "boolean", short: "h" },
    },
  });

  if (values.help) return console.log(HELP);
  if (positionals.length) fail(`unexpected argument: ${positionals[0]}\n\n${HELP}`);

  const interactive = !values.yes && process.stdin.isTTY && process.stdout.isTTY;
  if (interactive) intro("sf setup");

  const agentIds = values.agents
    ? list(values.agents)
    : interactive
      ? await ask(
          multiselect({
            message: "Install for which agents?",
            options: AGENTS.map((a) => ({ value: a.id, label: a.label })),
            initialValues: ["claude-code"],
            required: true,
          }),
        )
      : fail("--agents is required with --yes or without a terminal");
  const agents = agentIds.map((id) => AGENTS.find((a) => a.id === id) ?? fail(`unknown agent: ${id}`));

  const scope = (values.scope ??
    (interactive
      ? await ask(
          select({
            message: "Install where?",
            options: [
              { value: "global", label: "Globally", hint: "your home directory" },
              { value: "project", label: "This project", hint: process.cwd() },
            ],
          }),
        )
      : "global")) as Scope;
  if (scope !== "global" && scope !== "project") fail(`--scope must be global or project, got ${scope}`);
  const projectDir = path.resolve(values["project-dir"] ?? process.cwd());

  const optional = values.optional
    ? values.optional === "none"
      ? []
      : list(values.optional).map(
          (n) => OPTIONAL_SKILLS.find((s) => s.name === n) ?? fail(`unknown optional skill: ${n}`),
        )
    : interactive && OPTIONAL_SKILLS.length
      ? await ask(
          multiselect({
            message: "Install optional skills?",
            options: OPTIONAL_SKILLS.map((s) => ({ value: s, label: s.name, hint: s.description })),
            required: false,
          }),
        )
      : [];

  const skills: Skill[] = [PRIMARY_SKILL, ...optional];
  for (const agent of agents) {
    const dir = agent.skillsDir(scope, projectDir);
    for (const skill of skills) {
      const result = installSkill(skill, dir);
      log.success(`${result.updated ? "Updated" : "Installed"} ${skill.name} for ${agent.label}: ${result.path}`);
    }
  }

  if (interactive) outro("Done. Check `sf --version`, then ask your agent to run the sf skill.");
}

// ---------- helpers ----------

function list(value: string) {
  return value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

async function ask<T>(prompt: Promise<T | symbol>): Promise<T> {
  const value = await prompt;
  if (isCancel(value)) {
    cancel("Cancelled.");
    process.exit(0);
  }
  return value;
}

function fail(message: string): never {
  console.error(`sf: ${message}`);
  process.exit(1);
}

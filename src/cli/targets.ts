import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export type Scope = "global" | "project";

export type Agent = {
  id: string;
  label: string;
  /** Skills directory for a scope. `projectDir` is used for the project scope. */
  skillsDir: (scope: Scope, projectDir: string) => string;
};

export const AGENTS: Agent[] = [
  {
    id: "claude-code",
    label: "Claude Code",
    skillsDir: (scope, dir) => (scope === "global" ? path.join(os.homedir(), ".claude/skills") : path.join(dir, ".claude/skills")),
  },
  {
    id: "codex",
    label: "Codex",
    skillsDir: (scope, dir) => (scope === "global" ? path.join(os.homedir(), ".agents/skills") : path.join(dir, ".agents/skills")),
  },
  {
    id: "opencode",
    label: "OpenCode",
    skillsDir: (scope, dir) =>
      scope === "global" ? path.join(os.homedir(), ".config/opencode/skills") : path.join(dir, ".opencode/skills"),
  },
];

export type Skill = { name: string; description: string };

/** Always installed. */
export const PRIMARY_SKILL: Skill = {
  name: "sf-factory",
  description: "Runs the sf web interface and carries out its commands.",
};

/** Offered during setup. To be defined later. */
export const OPTIONAL_SKILLS: Skill[] = [];

/** Built skills ship next to the bundled CLI; from source, use the repo build. */
export function skillsSourceDir(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const dir = [path.join(here, "skills"), path.resolve(here, "../../dist/skills")].find((d) => fs.existsSync(d));
  if (!dir) throw new Error("built skills not found; run `pnpm build` first");
  return dir;
}

/** Copies a built skill into an agent's skills directory, replacing any previous copy. */
export function installSkill(skill: Skill, targetSkillsDir: string): { path: string; updated: boolean } {
  const source = path.join(skillsSourceDir(), skill.name);
  if (!fs.existsSync(path.join(source, "SKILL.md"))) throw new Error(`skill ${skill.name} is not built`);
  const target = path.join(targetSkillsDir, skill.name);
  const updated = fs.existsSync(target);
  fs.rmSync(target, { recursive: true, force: true });
  fs.mkdirSync(targetSkillsDir, { recursive: true });
  fs.cpSync(source, target, { recursive: true });
  return { path: target, updated };
}

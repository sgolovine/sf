import fs from "node:fs";
import { parse, stringify } from "yaml";
import type { FieldDef } from "#protocol";
import { SfError } from "./errors.ts";

/** A Story file's content. `fields` holds custom values and any keys the schema does not know. */
export type StoryData = {
  title: string;
  stage: string;
  branch?: string;
  fields: Record<string, unknown>;
  body: string;
};

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

export function parseStory(text: string): StoryData {
  const match = FRONTMATTER.exec(text);
  const data = match ? (parse(match[1]!) ?? {}) : {};
  if (typeof data !== "object" || Array.isArray(data)) throw new SfError("invalid", "Story frontmatter must be a mapping");
  const { title, stage, branch, ...fields } = data as Record<string, unknown>;
  return {
    title: title == null ? "" : String(title),
    stage: stage == null ? "" : String(stage),
    ...(branch == null ? {} : { branch: String(branch) }),
    fields,
    body: match ? text.slice(match[0].length) : text,
  };
}

export function serializeStory(story: StoryData): string {
  const front: Record<string, unknown> = { title: story.title, stage: story.stage };
  if (story.branch) front.branch = story.branch;
  for (const [k, v] of Object.entries(story.fields)) if (v !== undefined && v !== null) front[k] = v;
  const body = story.body.trim() ? `${story.body.replace(/\s+$/, "")}\n` : "";
  return `---\n${stringify(front).trimEnd()}\n---\n${body}`;
}

/** Story keys look like `DEV-12`. */
export function parseStoryKey(key: string): { boardKey: string; number: number } | null {
  const m = /^([A-Z][A-Z0-9]*)-(\d+)$/.exec(key);
  return m ? { boardKey: m[1]!, number: Number(m[2]) } : null;
}

/** Highest existing Story number for `key` in `dir`, plus one. */
export function nextStoryNumber(dir: string, key: string): number {
  let max = 0;
  const files = fs.existsSync(dir) ? fs.readdirSync(dir) : [];
  for (const file of files) {
    const parsed = file.endsWith(".md") ? parseStoryKey(file.slice(0, -3)) : null;
    if (parsed && parsed.boardKey === key) max = Math.max(max, parsed.number);
  }
  return max + 1;
}

/** Throws `invalid` when a value does not fit its schema field. Unknown keys are left alone. */
export function validateFields(schema: FieldDef[], fields: Record<string, unknown>) {
  for (const f of schema) {
    const v = fields[f.id];
    if (v === undefined || v === null) continue;
    const bad = (expected: string) => {
      throw new SfError("invalid", `field ${f.id} must be ${expected}, got ${JSON.stringify(v)}`);
    };
    switch (f.type) {
      case "text":
        if (typeof v !== "string") bad("text");
        break;
      case "number":
        if (typeof v !== "number" || !Number.isFinite(v)) bad("a number");
        break;
      case "boolean":
        if (typeof v !== "boolean") bad("true or false");
        break;
      case "date":
        if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(Date.parse(v))) bad("a YYYY-MM-DD date");
        break;
      case "single-select":
        if (typeof v !== "string" || !f.options?.includes(v)) bad(`one of ${f.options?.join(", ")}`);
        break;
      case "multi-select":
        if (!Array.isArray(v) || v.some((x) => typeof x !== "string" || !f.options?.includes(x)))
          bad(`a list of ${f.options?.join(", ")}`);
        break;
    }
  }
}

/**
 * Parses a CLI `--field k=v` against the schema. An empty value clears the
 * field (returns null). Multi-select values are comma-separated.
 */
export function parseFieldArg(schema: FieldDef[], arg: string): [string, unknown] {
  const eq = arg.indexOf("=");
  if (eq < 1) throw new SfError("invalid", `--field must look like key=value, got "${arg}"`);
  const id = arg.slice(0, eq);
  const raw = arg.slice(eq + 1);
  const field = schema.find((f) => f.id === id);
  if (!field) throw new SfError("invalid", `unknown field "${id}" (schema: ${schema.map((f) => f.id).join(", ") || "none"})`);
  if (raw === "") return [id, null];
  switch (field.type) {
    case "number":
      return [id, raw.trim() === "" || Number.isNaN(Number(raw)) ? raw : Number(raw)];
    case "boolean":
      return [id, raw === "true" ? true : raw === "false" ? false : raw];
    case "multi-select":
      return [
        id,
        raw
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
      ];
    default:
      return [id, raw];
  }
}

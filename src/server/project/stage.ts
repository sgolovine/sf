import fs from "node:fs";
import { parse, stringify } from "yaml";
import { SfError } from "./errors.ts";

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;

/** Read metadata separately so YAML never appears in a Stage Prompt. */
export function readStage(file: string): { metadata: Record<string, unknown>; body: string } {
  const text = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
  const match = FRONTMATTER.exec(text);
  const metadata = match ? (parse(match[1]!) ?? {}) : {};
  if (typeof metadata !== "object" || Array.isArray(metadata))
    throw new SfError("invalid", "Stage frontmatter must be a mapping");
  return { metadata, body: match ? text.slice(match[0].length) : text };
}

export function serializeStage(metadata: Record<string, unknown>, body: string): string {
  return Object.keys(metadata).length ? `---\n${stringify(metadata).trimEnd()}\n---\n${body}` : body;
}

import type { BoardConfig, ProjectConfig } from "./config.ts";
import type { RuntimeState } from "./runtime.ts";

export type StoryView = {
  key: string;
  /** Board id. */
  board: string;
  title: string;
  stage: string;
  dependsOn?: string[];
  branch?: string;
  model?: string | null;
  /** Keys not Done, including missing or unreadable prerequisites. */
  unresolvedDependencies?: string[];
  waitingOnDependencies?: boolean;
  /** Custom field values by field id, plus any frontmatter keys the schema does not know. */
  fields: Record<string, unknown>;
  body: string;
};

export type BoardSnapshot = {
  id: string;
  config: BoardConfig;
  /** Stage Prompt text by Stage id. */
  prompts: Record<string, string>;
  stories: StoryView[];
};

export type ProjectSnapshot = {
  root: string;
  config: ProjectConfig;
  boards: BoardSnapshot[];
  runtime: RuntimeState;
};

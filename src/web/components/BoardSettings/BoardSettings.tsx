import { useId } from "react";
import type { ProjectConfig } from "#model/config";
import type { BoardSnapshot } from "#model/project";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { Act } from "../ErrorBanner.tsx";
import { ModelSettings } from "../ModelSettings.tsx";
import { CustomFieldsTab } from "./CustomFieldsTab.tsx";
import { StagePromptsTab } from "./StagePromptsTab.tsx";
import { StagesTab } from "./StagesTab.tsx";

export type SettingsTab = "stages" | "fields" | "prompts" | "worker";

type Props = {
  project: ProjectConfig;
  board: BoardSnapshot;
  tab: SettingsTab;
  onTab: (tab: SettingsTab) => void;
  act: Act;
};

const sections = [
  ["worker", "Worker"],
  ["stages", "Stages"],
  ["fields", "Custom Fields"],
  ["prompts", "Stage Prompts"],
] as const;

/** A Board's settings page: its Stages, its Story custom fields, and its Stage Prompts. */
export function BoardSettings({ project, board, tab, onTab, act }: Props) {
  const sectionId = useId();
  return (
    <div className="@container/settings w-full">
      <Tabs
        orientation="vertical"
        value={tab}
        onValueChange={(v) => onTab(v as SettingsTab)}
        className="mx-auto min-w-0 max-w-6xl flex-col gap-4 p-3 @3xl/settings:flex-row @3xl/settings:gap-6 @3xl/settings:p-6"
      >
        <div className="shrink-0 border-b pb-3 @3xl/settings:w-40 @3xl/settings:border-r @3xl/settings:border-b-0 @3xl/settings:pr-4">
          <label htmlFor={sectionId} className="mb-1 block text-sm font-medium @3xl/settings:hidden">
            Settings section
          </label>
          <select
            id={sectionId}
            value={tab}
            onChange={(event) => onTab(event.target.value as SettingsTab)}
            className="h-9 w-full rounded-md border bg-background px-2 text-sm @3xl/settings:hidden"
          >
            {sections.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          <TabsList aria-label="Board settings sections" className="hidden w-full bg-transparent @3xl/settings:flex">
            {sections.map(([value, label]) => (
              <TabsTrigger key={value} value={value} className="min-h-9 flex-none">
                {label}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>
        <div className="min-w-0 flex-1">
          <TabsContent value="worker">
            <ModelSettings
              key={JSON.stringify([project, board.config])}
              project={project}
              board={board.config}
              boardId={board.id}
              act={act}
            />
          </TabsContent>
          <TabsContent value="stages">
            <StagesTab key={board.id} board={board} act={act} />
          </TabsContent>
          <TabsContent value="fields">
            {/* Remount when the saved schema changes so the form shows what the server stored. */}
            <CustomFieldsTab key={`${board.id}:${JSON.stringify(board.config.schema)}`} board={board} act={act} />
          </TabsContent>
          <TabsContent value="prompts">
            <StagePromptsTab key={board.id} project={project} board={board} act={act} />
          </TabsContent>
        </div>
      </Tabs>
    </div>
  );
}

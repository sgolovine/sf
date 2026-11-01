import { useId } from "react";
import type { ProjectConfig } from "#model/config";
import type { BoardSnapshot } from "#model/project";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { Act } from "../ErrorBanner.tsx";
import { ModelSettings } from "../ModelSettings.tsx";
import { SchedulingSettings } from "../SchedulingSettings.tsx";
import { CustomFieldsTab } from "./CustomFieldsTab.tsx";
import { StagePromptsTab } from "./StagePromptsTab.tsx";
import { StagesTab } from "./StagesTab.tsx";

export type SettingsTab = "project-worker" | "scheduling" | "board-worker" | "stages" | "fields" | "prompts";

type Props = {
  project: ProjectConfig;
  /** The selected Board; without one, only the Project sections are shown. */
  board: BoardSnapshot | undefined;
  tab: SettingsTab;
  onTab: (tab: SettingsTab) => void;
  act: Act;
};

const projectSections = [
  ["project-worker", "Worker"],
  ["scheduling", "Scheduling"],
] as const;

const boardSections = [
  ["board-worker", "Worker"],
  ["stages", "Stages"],
  ["fields", "Custom Fields"],
  ["prompts", "Stage Prompts"],
] as const;

/** Project settings, then the selected Board's settings, in one page with grouped section navigation. */
export function Settings({ project, board, tab: requested, onTab, act }: Props) {
  const sectionId = useId();
  const groups = [
    { label: "Project", sections: projectSections },
    ...(board ? [{ label: `Board: ${board.config.name}`, sections: boardSections }] : []),
  ];
  // A Board section cannot be shown without a Board.
  const tab = board || projectSections.some(([value]) => value === requested) ? requested : "project-worker";
  return (
    <div className="@container/settings w-full">
      <Tabs
        orientation="vertical"
        value={tab}
        onValueChange={(v) => onTab(v as SettingsTab)}
        className="mx-auto min-w-0 max-w-6xl flex-col gap-4 p-3 @3xl/settings:flex-row @3xl/settings:gap-6 @3xl/settings:p-6"
      >
        <div className="shrink-0 border-b pb-3 @3xl/settings:w-48 @3xl/settings:border-r @3xl/settings:border-b-0 @3xl/settings:pr-4">
          <label htmlFor={sectionId} className="mb-1 block text-sm font-medium @3xl/settings:hidden">
            Settings section
          </label>
          <select
            id={sectionId}
            value={tab}
            onChange={(event) => onTab(event.target.value as SettingsTab)}
            className="h-9 w-full rounded-md border bg-background px-2 text-sm @3xl/settings:hidden"
          >
            {groups.map((group) => (
              <optgroup key={group.label} label={group.label}>
                {group.sections.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
          <nav aria-label="Settings sections" className="hidden flex-col gap-4 @3xl/settings:flex">
            {groups.map((group, index) => (
              <div key={group.label} className="flex flex-col gap-1">
                <p
                  id={`${sectionId}-group-${index}`}
                  className="truncate px-2 text-xs font-medium text-muted-foreground"
                  title={group.label}
                >
                  {group.label}
                </p>
                <TabsList aria-labelledby={`${sectionId}-group-${index}`} className="w-full bg-transparent p-0">
                  {group.sections.map(([value, label]) => (
                    <TabsTrigger key={value} value={value} className="min-h-9 flex-none">
                      {label}
                    </TabsTrigger>
                  ))}
                </TabsList>
              </div>
            ))}
          </nav>
        </div>
        <div className="min-w-0 flex-1">
          {/* Remount Project forms when the saved Project changes so they show what the server stored. */}
          <TabsContent value="project-worker">
            <ModelSettings key={JSON.stringify(project)} project={project} act={act} />
          </TabsContent>
          <TabsContent value="scheduling">
            <SchedulingSettings key={JSON.stringify(project)} project={project} act={act} />
          </TabsContent>
          {board && (
            <>
              <TabsContent value="board-worker">
                <ModelSettings
                  key={JSON.stringify([board.id, project, board.config])}
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
            </>
          )}
        </div>
      </Tabs>
    </div>
  );
}

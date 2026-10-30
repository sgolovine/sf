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

/** A Board's settings page: its Stages, its Story custom fields, and its Stage Prompts. */
export function BoardSettings({ project, board, tab, onTab, act }: Props) {
  return (
    <div className="mx-auto w-full max-w-4xl p-6">
      <Tabs value={tab} onValueChange={(v) => onTab(v as SettingsTab)}>
        <TabsList>
          <TabsTrigger value="worker">Worker</TabsTrigger>
          <TabsTrigger value="stages">Stages</TabsTrigger>
          <TabsTrigger value="fields">Custom Fields</TabsTrigger>
          <TabsTrigger value="prompts">Stage Prompts</TabsTrigger>
        </TabsList>
        <TabsContent value="worker">
          <ModelSettings
            key={JSON.stringify([project, board.config])}
            project={project}
            board={board.config}
            boardId={board.id}
            act={act}
          />
        </TabsContent>
        <TabsContent value="stages" className="mt-4">
          <StagesTab board={board} act={act} />
        </TabsContent>
        <TabsContent value="fields" className="mt-4">
          {/* Remount when the saved schema changes so the form shows what the server stored. */}
          <CustomFieldsTab key={`${board.id}:${JSON.stringify(board.config.schema)}`} board={board} act={act} />
        </TabsContent>
        <TabsContent value="prompts" className="mt-4">
          <StagePromptsTab key={board.id} project={project} board={board} act={act} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

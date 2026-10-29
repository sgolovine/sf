import type { BoardSnapshot } from "#protocol";
import type { Act } from "../ErrorBanner.tsx";
import { CustomFieldsTab } from "./CustomFieldsTab.tsx";
import { StagePromptsTab } from "./StagePromptsTab.tsx";
import { StagesTab } from "./StagesTab.tsx";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export type SettingsTab = "stages" | "fields" | "prompts";

type Props = { board: BoardSnapshot; tab: SettingsTab; onTab: (tab: SettingsTab) => void; act: Act };

/** A Board's settings page: its Stages, its Story custom fields, and its Stage Prompts. */
export function BoardSettings({ board, tab, onTab, act }: Props) {
  return (
    <div className="mx-auto w-full max-w-4xl p-6">
      <Tabs value={tab} onValueChange={(v) => onTab(v as SettingsTab)}>
        <TabsList>
          <TabsTrigger value="stages">Stages</TabsTrigger>
          <TabsTrigger value="fields">Custom Fields</TabsTrigger>
          <TabsTrigger value="prompts">Stage Prompts</TabsTrigger>
        </TabsList>
        <TabsContent value="stages" className="mt-4">
          <StagesTab board={board} act={act} />
        </TabsContent>
        <TabsContent value="fields" className="mt-4">
          {/* Remount when the saved schema changes so the form shows what the server stored. */}
          <CustomFieldsTab key={`${board.id}:${JSON.stringify(board.config.schema)}`} board={board} act={act} />
        </TabsContent>
        <TabsContent value="prompts" className="mt-4">
          <StagePromptsTab key={board.id} board={board} act={act} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

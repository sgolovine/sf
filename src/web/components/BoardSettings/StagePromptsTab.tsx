import { useId, useState } from "react";
import type { StageConfig } from "#model/config";
import type { BoardSnapshot } from "#model/project";
import { sfApi } from "../../api/client.ts";
import type { Act } from "../ErrorBanner.tsx";
import { FIXED_STAGES } from "./fixed.ts";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";

/** One card per Stage that can run a Worker: its Stage Prompt, the enabled flag, and agent/model overrides. */
export function StagePromptsTab({ board, act }: { board: BoardSnapshot; act: Act }) {
  const stages = board.config.stages.filter((s) => !FIXED_STAGES.has(s.id));
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        When a Story enters a Stage with an enabled Stage Prompt, a Worker runs that prompt. Backlog and Done never run a
        Worker.
      </p>
      {stages.length === 0 && <p className="text-sm text-muted-foreground">Add a Stage to give it a prompt.</p>}
      {stages.map((stage) => (
        <PromptCard key={stage.id} board={board} stage={stage} act={act} />
      ))}
    </div>
  );
}

function PromptCard({ board, stage, act }: { board: BoardSnapshot; stage: StageConfig; act: Act }) {
  const id = useId();
  const saved = { enabled: stage.promptEnabled, prompt: board.prompts[stage.id] ?? "", agent: stage.agent ?? "", model: stage.model ?? "" };
  const [enabled, setEnabled] = useState(saved.enabled);
  const [prompt, setPrompt] = useState(saved.prompt);
  const [agent, setAgent] = useState(saved.agent);
  const [model, setModel] = useState(saved.model);
  const dirty = enabled !== saved.enabled || prompt !== saved.prompt || agent !== saved.agent || model !== saved.model;

  return (
    <Card>
      <form
        className="contents"
        onSubmit={(e) => {
          e.preventDefault();
          void act(() =>
            sfApi.updateStage(board.id, stage.id, { promptEnabled: enabled, prompt, agent: agent || null, model: model || null }),
          );
        }}
      >
        <CardHeader>
          <CardTitle>{stage.name}</CardTitle>
          <CardDescription>
            {saved.enabled ? (saved.prompt.trim() ? "Runs a Worker" : "Enabled, but the prompt is empty") : "Disabled"}
          </CardDescription>
          <CardAction className="flex items-center gap-2">
            <Label htmlFor={`${id}-enabled`}>Enabled</Label>
            <Switch id={`${id}-enabled`} checked={enabled} onCheckedChange={setEnabled} />
          </CardAction>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="grid gap-2">
            <Label htmlFor={`${id}-prompt`}>Stage Prompt</Label>
            <Textarea
              id={`${id}-prompt`}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={8}
              className="font-mono text-sm"
              placeholder="Instructions for the Worker that runs when a Story enters this Stage."
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor={`${id}-agent`}>Agent override</Label>
              <Input id={`${id}-agent`} value={agent} onChange={(e) => setAgent(e.target.value)} placeholder="Board/Project default" />
            </div>
            <div className="grid gap-2">
              <Label htmlFor={`${id}-model`}>Model override</Label>
              <Input id={`${id}-model`} value={model} onChange={(e) => setModel(e.target.value)} placeholder="Board/Project default" />
            </div>
          </div>
        </CardContent>
        <CardFooter className="justify-end">
          <Button type="submit" disabled={!dirty}>
            Save
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
}

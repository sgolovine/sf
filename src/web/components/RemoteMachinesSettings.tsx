import { Plus, Trash2 } from "lucide-react";
import { useId, useState } from "react";
import type { ProjectConfig } from "#model/config";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { sfApi } from "../api/client.ts";
import { blankRemote, draftRemotes, followOrder, type RemoteDraft, toRemoteMachines } from "../lib/schedulingDraft.ts";
import type { Act } from "./ErrorBanner.tsx";

/** The Project's remote machine catalog, independent of per-machine scheduling. */
export function RemoteMachinesSettings({ project, act }: { project: ProjectConfig; act: Act }) {
  const id = useId();
  const [remotes, setRemotes] = useState<RemoteDraft[]>(() => draftRemotes(project.remoteMachines));
  const updateRemote = (index: number, patch: Partial<RemoteDraft>) =>
    setRemotes(remotes.map((r, i) => (i === index ? { ...r, ...patch } : r)));

  return (
    <form
      className="mx-auto flex w-full max-w-2xl flex-col gap-5 p-6"
      onSubmit={(e) => {
        e.preventDefault();
        const { scheduling } = project;
        void act(() =>
          sfApi.updateProject({
            remoteMachines: toRemoteMachines(remotes),
            // One save: the machine order follows renamed slugs and drops removed ones.
            ...(scheduling ? { scheduling: { ...scheduling, order: followOrder(scheduling.order, remotes) } } : {}),
          }),
        );
      }}
    >
      <h2 className="text-lg font-semibold">Remote machines</h2>
      <p className="text-sm text-muted-foreground">
        Machines a Story's placement can name. When sf selects one, it tells the Supervisor's harness which machine to
        use; the harness finds, prepares and launches on it. A request is not proof of where a Worker runs.
        {!project.scheduling && " Without per-machine scheduling, Stories without a placement still run locally."}
      </p>
      {remotes.length === 0 && <p className="text-sm text-muted-foreground">No remote machines.</p>}
      {remotes.map((r, index) => {
        const field = (key: string) => `${id}-remote-${index}-${key}`;
        const label = r.name || r.id || `Remote ${index + 1}`;
        return (
          <div key={r.key} className="grid gap-3 rounded-md border p-3 sm:grid-cols-2">
            <div className="grid gap-1">
              <Label htmlFor={field("name")}>Machine label</Label>
              <Input
                id={field("name")}
                value={r.name}
                onChange={(e) => updateRemote(index, { name: e.target.value })}
              />
            </div>
            <div className="grid gap-1">
              <Label htmlFor={field("id")}>Machine slug</Label>
              <Input
                id={field("id")}
                value={r.id}
                placeholder="lowercase-slug"
                onChange={(e) => updateRemote(index, { id: e.target.value })}
              />
            </div>
            <div className="grid gap-1">
              <Label htmlFor={field("cap")}>Maximum concurrent Workers</Label>
              <Input
                id={field("cap")}
                type="number"
                min={0}
                value={r.capacity}
                placeholder={`Inherit (${project.maxConcurrentWorkers})`}
                onChange={(e) => updateRemote(index, { capacity: e.target.value })}
              />
            </div>
            <div className="flex items-end justify-between gap-2">
              <div className="flex items-center gap-2 pb-2">
                <Switch
                  id={field("enabled")}
                  checked={r.enabled}
                  onCheckedChange={(enabled) => updateRemote(index, { enabled })}
                />
                <Label htmlFor={field("enabled")}>Enabled</Label>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={`Remove ${label}`}
                onClick={() => setRemotes(remotes.filter((_, i) => i !== index))}
              >
                <Trash2 className="text-destructive" />
              </Button>
            </div>
          </div>
        );
      })}
      <Button
        type="button"
        variant="outline"
        className="justify-self-start self-start"
        onClick={() => setRemotes([...remotes, blankRemote(remotes)])}
      >
        <Plus /> Add remote machine
      </Button>
      <p className="text-xs text-muted-foreground">
        Leave the maximum blank to use the Project maximum. Disable a machine to keep Stories pinned to it waiting. A
        slug a Story or a running Worker still uses cannot be removed or changed.
      </p>
      <Button type="submit">Save remote machines</Button>
    </form>
  );
}

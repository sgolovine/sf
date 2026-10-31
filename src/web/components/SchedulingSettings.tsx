import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { useId, useState } from "react";
import type { ProjectConfig, SchedulingConfig } from "#model/config";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { sfApi } from "../api/client.ts";
import type { Act } from "./ErrorBanner.tsx";

type Remote = SchedulingConfig["remotes"][number];
/** Capacities are edited as text; the server validates them on save. */
type RemoteDraft = Omit<Remote, "capacity"> & { capacity: string };

const blank = (): RemoteDraft => ({
  id: "",
  name: "",
  environmentId: "",
  project: { projectId: "", repository: "" },
  enabled: true,
  capacity: "1",
});

/** Project-wide Worker capacity: the legacy total, or per-machine caps and an ordered machine preference. */
export function SchedulingSettings({ project, act }: { project: ProjectConfig; act: Act }) {
  const id = useId();
  const current = project.scheduling;
  const [enabled, setEnabled] = useState(!!current);
  const [max, setMax] = useState(String(project.maxConcurrentWorkers));
  const [local, setLocal] = useState(String(current?.local.capacity ?? project.maxConcurrentWorkers));
  const [remotes, setRemotes] = useState<RemoteDraft[]>(
    current?.remotes.map((r) => ({ ...r, capacity: String(r.capacity) })) ?? [],
  );
  const [order, setOrder] = useState<string[]>(current?.order ?? ["local"]);
  const [adding, setAdding] = useState("");
  const machineIds = ["local", ...remotes.map((r) => r.id).filter(Boolean)];
  const addable = machineIds.filter((m) => !order.includes(m));

  const updateRemote = (index: number, patch: Partial<RemoteDraft>) => {
    const before = remotes[index]!;
    if (patch.id !== undefined && before.id && order.includes(before.id))
      setOrder(order.map((m) => (m === before.id ? patch.id! : m)));
    setRemotes(remotes.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  };
  const move = (index: number, by: number) => {
    const next = [...order];
    [next[index], next[index + by]] = [next[index + by]!, next[index]!];
    setOrder(next);
  };
  const toNumber = (text: string) => (text.trim() === "" ? Number.NaN : Number(text));

  return (
    <form
      className="mx-auto flex w-full max-w-2xl flex-col gap-5 p-6"
      onSubmit={(e) => {
        e.preventDefault();
        void act(() =>
          sfApi.updateProject(
            enabled
              ? {
                  scheduling: {
                    local: { capacity: toNumber(local) },
                    remotes: remotes.map((r) => ({ ...r, capacity: toNumber(r.capacity) })),
                    order,
                  },
                }
              : { scheduling: null, maxConcurrentWorkers: toNumber(max) },
          ),
        );
      }}
    >
      <div className="flex items-center justify-between gap-4">
        <h2 className="text-lg font-semibold">Scheduling</h2>
        <div className="flex items-center gap-2">
          <Switch id={`${id}-enabled`} checked={enabled} onCheckedChange={setEnabled} />
          <Label htmlFor={`${id}-enabled`}>Per-machine scheduling</Label>
        </div>
      </div>
      <p className="text-sm text-muted-foreground">
        Limits apply to the whole Project, across every Board.{" "}
        {enabled
          ? "Per-machine limits replace the legacy total. sf reserves a slot on the first machine in the order with room, and asks the Supervisor's harness to start remote Workers there; a request is not proof of where a Worker runs."
          : "All Workers run on the Supervisor's machine, up to this total."}
      </p>
      {!enabled ? (
        <div className="grid gap-2">
          <Label htmlFor={`${id}-max`}>Maximum concurrent Workers</Label>
          <Input
            id={`${id}-max`}
            type="number"
            min={0}
            value={max}
            onChange={(e) => setMax(e.target.value)}
            className="w-32"
          />
        </div>
      ) : (
        <>
          <div className="grid gap-2">
            <Label htmlFor={`${id}-local`}>Local capacity (the Supervisor's machine)</Label>
            <Input
              id={`${id}-local`}
              type="number"
              min={0}
              value={local}
              onChange={(e) => setLocal(e.target.value)}
              className="w-32"
            />
          </div>
          <fieldset className="grid gap-3">
            <legend className="mb-2 text-sm font-medium">Remote machines</legend>
            {remotes.length === 0 && <p className="text-sm text-muted-foreground">No remote machines.</p>}
            {remotes.map((r, index) => {
              const field = (key: string) => `${id}-remote-${index}-${key}`;
              const label = r.name || r.id || `Remote ${index + 1}`;
              return (
                // biome-ignore lint/suspicious/noArrayIndexKey: drafts have no stable identity until saved
                <div key={index} className="grid gap-3 rounded-md border p-3 sm:grid-cols-2">
                  <div className="grid gap-1">
                    <Label htmlFor={field("id")}>Machine ID</Label>
                    <Input
                      id={field("id")}
                      value={r.id}
                      placeholder="lowercase-slug"
                      onChange={(e) => updateRemote(index, { id: e.target.value })}
                    />
                  </div>
                  <div className="grid gap-1">
                    <Label htmlFor={field("name")}>Name</Label>
                    <Input
                      id={field("name")}
                      value={r.name}
                      onChange={(e) => updateRemote(index, { name: e.target.value })}
                    />
                  </div>
                  <div className="grid gap-1">
                    <Label htmlFor={field("env")}>Environment ID</Label>
                    <Input
                      id={field("env")}
                      value={r.environmentId}
                      onChange={(e) => updateRemote(index, { environmentId: e.target.value })}
                    />
                  </div>
                  <div className="grid gap-1">
                    <Label htmlFor={field("project")}>Project ID</Label>
                    <Input
                      id={field("project")}
                      value={r.project.projectId}
                      onChange={(e) => updateRemote(index, { project: { ...r.project, projectId: e.target.value } })}
                    />
                  </div>
                  <div className="grid gap-1 sm:col-span-2">
                    <Label htmlFor={field("repo")}>Repository</Label>
                    <Input
                      id={field("repo")}
                      value={r.project.repository}
                      placeholder="github.com/owner/repo"
                      onChange={(e) => updateRemote(index, { project: { ...r.project, repository: e.target.value } })}
                    />
                  </div>
                  <div className="grid gap-1">
                    <Label htmlFor={field("cap")}>Capacity</Label>
                    <Input
                      id={field("cap")}
                      type="number"
                      min={0}
                      value={r.capacity}
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
                      onClick={() => {
                        setOrder(order.filter((m) => m !== r.id));
                        setRemotes(remotes.filter((_, i) => i !== index));
                      }}
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
              className="justify-self-start"
              onClick={() => setRemotes([...remotes, blank()])}
            >
              <Plus /> Add remote machine
            </Button>
            <p className="text-xs text-muted-foreground">
              Disable a machine to keep Stories pinned to it waiting. A machine a Story or a running Worker still uses
              cannot be removed or remapped.
            </p>
          </fieldset>
          <fieldset className="grid gap-2">
            <legend className="mb-2 text-sm font-medium">Machine order</legend>
            <p className="text-xs text-muted-foreground">
              Stories without a placement use the first machine with room. Leave local out to keep them off the
              Supervisor's machine; an empty order makes them wait.
            </p>
            <ol className="grid gap-1">
              {order.map((m, index) => (
                <li key={m} className="flex items-center gap-2 rounded-md border px-2 py-1 text-sm">
                  <span className="w-5 text-muted-foreground">{index + 1}.</span>
                  <span className="flex-1">{m}</span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Move ${m} up`}
                    disabled={index === 0}
                    onClick={() => move(index, -1)}
                  >
                    <ArrowUp />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Move ${m} down`}
                    disabled={index === order.length - 1}
                    onClick={() => move(index, 1)}
                  >
                    <ArrowDown />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Remove ${m} from the order`}
                    onClick={() => setOrder(order.filter((x) => x !== m))}
                  >
                    <Trash2 />
                  </Button>
                </li>
              ))}
            </ol>
            {addable.length > 0 && (
              <div className="flex items-center gap-2">
                <Select value={adding && addable.includes(adding) ? adding : ""} onValueChange={setAdding}>
                  <SelectTrigger aria-label="Machine to add to the order" className="w-48">
                    <SelectValue placeholder="Machine" />
                  </SelectTrigger>
                  <SelectContent>
                    {addable.map((m) => (
                      <SelectItem key={m} value={m}>
                        {m}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  type="button"
                  variant="outline"
                  disabled={!addable.includes(adding)}
                  onClick={() => {
                    setOrder([...order, adding]);
                    setAdding("");
                  }}
                >
                  Add to order
                </Button>
              </div>
            )}
          </fieldset>
        </>
      )}
      <Button type="submit">Save scheduling</Button>
    </form>
  );
}

import { ArrowDown, ArrowUp, Trash2 } from "lucide-react";
import { useId, useState } from "react";
import type { ProjectConfig } from "#model/config";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { sfApi } from "../api/client.ts";
import { toNumber } from "../lib/schedulingDraft.ts";
import type { Act } from "./ErrorBanner.tsx";

/** Project-wide Worker capacity: the Project maximum, and optional local capacity and machine order. */
export function SchedulingSettings({ project, act }: { project: ProjectConfig; act: Act }) {
  const id = useId();
  const current = project.scheduling;
  const [enabled, setEnabled] = useState(!!current);
  const [max, setMax] = useState(String(project.maxConcurrentWorkers));
  const [local, setLocal] = useState(String(current?.local.capacity ?? project.maxConcurrentWorkers));
  const [order, setOrder] = useState<string[]>(current?.order ?? ["local"]);
  const [adding, setAdding] = useState("");
  const remotes = project.remoteMachines ?? [];
  const addable = ["local", ...remotes.map((r) => r.id)].filter((machine) => !order.includes(machine));
  const label = (machine: string) => {
    const remote = remotes.find((r) => r.id === machine);
    return remote ? `${remote.name} (${remote.id})` : machine;
  };

  const move = (index: number, by: number) => {
    const next = [...order];
    [next[index], next[index + by]] = [next[index + by]!, next[index]!];
    setOrder(next);
  };

  return (
    <form
      className="mx-auto flex w-full max-w-2xl flex-col gap-5 p-6"
      onSubmit={(e) => {
        e.preventDefault();
        void act(() =>
          sfApi.updateProject({
            maxConcurrentWorkers: toNumber(max),
            scheduling: enabled ? { local: { capacity: toNumber(local) }, order } : null,
          }),
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
          ? "Stories without a placement use the first machine in the order with room."
          : "Stories without a placement run on the Supervisor's machine, up to the Project maximum."}
      </p>
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
        <p className="text-xs text-muted-foreground">
          A per-machine default, not a total: {enabled ? "" : "the local capacity, and "}the capacity of each remote
          machine that does not set its own.
        </p>
      </div>
      {enabled && (
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
          <fieldset className="grid gap-2">
            <legend className="mb-2 text-sm font-medium">Machine order</legend>
            <p className="text-xs text-muted-foreground">
              Leave local out to keep Stories without a placement off the Supervisor's machine; an empty order makes
              them wait. Add machines to the order under Remote machines first.
            </p>
            <ol className="grid gap-1">
              {order.map((machine, index) => (
                <li key={machine} className="flex items-center gap-2 rounded-md border px-2 py-1 text-sm">
                  <span className="w-5 text-muted-foreground">{index + 1}.</span>
                  <span className="flex-1">{label(machine)}</span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Move ${label(machine)} up`}
                    disabled={index === 0}
                    onClick={() => move(index, -1)}
                  >
                    <ArrowUp />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Move ${label(machine)} down`}
                    disabled={index === order.length - 1}
                    onClick={() => move(index, 1)}
                  >
                    <ArrowDown />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Remove ${label(machine)} from the order`}
                    onClick={() => setOrder(order.filter((x) => x !== machine))}
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
                    {addable.map((machine) => (
                      <SelectItem key={machine} value={machine}>
                        {label(machine)}
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

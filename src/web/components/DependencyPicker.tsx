import { CheckIcon, ChevronDownIcon, XIcon } from "lucide-react";
import { type KeyboardEvent, useId, useMemo, useRef, useState } from "react";
import type { BoardSnapshot } from "#model/project";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Popover, PopoverAnchor, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

type Props = {
  id: string;
  value: string[];
  onChange: (keys: string[]) => void;
  /** Every Board in the Project; dependencies may cross Boards. */
  boards: BoardSnapshot[];
  /** The Board of the Story being edited; other Boards are named in options. */
  boardId: string;
  /** The Story being edited, never offered as its own dependency. */
  selfKey?: string;
  disabled?: boolean;
};

type Option = { key: string; title: string; boardName?: string };

const keyNumber = (key: string) => Number(key.match(/-(\d+)$/)?.[1] ?? 0);

/** Searchable multi-select of Story keys; selected keys render as removable pills in selection order. */
export function DependencyPicker({ id, value, onChange, boards, boardId, selfKey, disabled }: Props) {
  const listId = useId();
  const searchRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);

  const options = useMemo(
    () =>
      boards.flatMap((b) =>
        [...b.stories]
          .filter((s) => s.key !== selfKey)
          .sort((x, y) => keyNumber(x.key) - keyNumber(y.key))
          .map(
            (s): Option => ({ key: s.key, title: s.title, boardName: b.id === boardId ? undefined : b.config.name }),
          ),
      ),
    [boards, boardId, selfKey],
  );
  const byKey = useMemo(() => new Map(options.map((o) => [o.key, o])), [options]);
  const q = query.trim().toLowerCase();
  const shown = q
    ? options.filter((o) => o.key.toLowerCase().includes(q) || o.title.toLowerCase().includes(q))
    : options;

  const toggle = (key: string) => {
    if (disabled) return;
    onChange(value.includes(key) ? value.filter((k) => k !== key) : [...value, key]);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!shown.length) return;
      const step = e.key === "ArrowDown" ? 1 : -1;
      setActive((i) => (i + step + shown.length) % shown.length);
    } else if (e.key === "Enter") {
      // Never submit the editor form from the search box.
      e.preventDefault();
      const option = shown[active];
      if (option) toggle(option.key);
    } else if (e.key === "Backspace" && !query && value.length) {
      onChange(value.slice(0, -1));
    }
  };

  return (
    <Popover
      modal
      open={open && !disabled}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setQuery("");
        setActive(0);
      }}
    >
      <PopoverAnchor asChild>
        <div
          className={cn(
            "flex min-h-9 w-full flex-wrap items-center gap-1 rounded-md border border-input px-1.5 py-1 shadow-xs dark:bg-input/30",
            disabled && "opacity-50",
          )}
        >
          {value.map((key) => {
            const option = byKey.get(key);
            return (
              <Badge
                key={key}
                variant={option ? "secondary" : "outline"}
                className={cn(
                  "max-w-full gap-1 pr-0.5",
                  !option && "border-dashed border-destructive text-destructive",
                )}
                title={option ? `${key}: ${option.title}` : `${key} is not a Story in this Project`}
              >
                <span className="truncate">
                  {key}
                  {option ? <span className="font-normal"> {option.title}</span> : " (missing)"}
                </span>
                <button
                  type="button"
                  aria-label={`Remove ${key}`}
                  disabled={disabled}
                  onClick={() => onChange(value.filter((k) => k !== key))}
                  className="rounded-full p-0.5 hover:bg-foreground/10 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none disabled:pointer-events-none"
                >
                  <XIcon className="size-3" />
                </button>
              </Badge>
            );
          })}
          <PopoverTrigger asChild>
            <button
              id={id}
              type="button"
              disabled={disabled}
              className="ml-auto flex h-7 flex-1 items-center justify-between gap-2 rounded-sm px-1.5 text-sm text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:cursor-not-allowed"
            >
              <span className="whitespace-nowrap">{value.length ? "Add more…" : "Select Stories…"}</span>
              <ChevronDownIcon className="size-4 shrink-0 opacity-50" />
            </button>
          </PopoverTrigger>
        </div>
      </PopoverAnchor>
      <PopoverContent
        align="start"
        className="w-(--radix-popover-trigger-width) min-w-72 p-0"
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          searchRef.current?.focus();
        }}
      >
        <div className="border-b p-2">
          <Input
            ref={searchRef}
            role="combobox"
            aria-label="Search Stories"
            aria-expanded
            aria-controls={listId}
            aria-activedescendant={shown[active] ? `${listId}-${shown[active].key}` : undefined}
            placeholder="Search by key or title"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            onKeyDown={onKeyDown}
            className="h-8"
          />
        </div>
        {shown.length ? (
          <div id={listId} role="listbox" aria-multiselectable className="max-h-64 overflow-y-auto p-1">
            {shown.map((o, i) => {
              const selected = value.includes(o.key);
              return (
                // biome-ignore lint/a11y/useKeyWithClickEvents: keyboard selection goes through the search combobox
                <div
                  key={o.key}
                  id={`${listId}-${o.key}`}
                  role="option"
                  tabIndex={-1}
                  aria-selected={selected}
                  className={cn(
                    "flex cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-sm",
                    i === active && "bg-accent text-accent-foreground",
                  )}
                  onMouseMove={() => setActive(i)}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => toggle(o.key)}
                >
                  <CheckIcon className={cn("size-4 shrink-0", !selected && "invisible")} />
                  <span className="shrink-0 font-medium">{o.key}</span>
                  <span className="truncate">{o.title}</span>
                  {o.boardName && <span className="ml-auto shrink-0 text-xs text-muted-foreground">{o.boardName}</span>}
                </div>
              );
            })}
          </div>
        ) : (
          <p className="px-3 py-4 text-center text-sm text-muted-foreground">No matching Stories</p>
        )}
      </PopoverContent>
    </Popover>
  );
}

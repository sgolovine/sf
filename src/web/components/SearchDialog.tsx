import { SearchIcon } from "lucide-react";
import { useRef, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { useSearch } from "../api/hooks.ts";

/** The finder: fuzzy-searches Stories on every Board; picking one calls `onSelect` with its key. */
export function SearchDialog({ onSelect, onClose }: { onSelect: (key: string) => void; onClose: () => void }) {
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const { data, isFetched } = useSearch(query);
  const results = query.trim() ? (data ?? []) : [];
  // Typing resets the highlight to the first row; a shorter list clamps it.
  const active = Math.max(0, Math.min(highlight, results.length - 1));

  const pick = (key: string) => {
    onClose();
    onSelect(key);
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className="top-[15%] translate-y-0 gap-0 overflow-hidden p-0 sm:max-w-xl"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          input.current?.focus();
        }}
      >
        <DialogTitle className="sr-only">Search Stories</DialogTitle>
        <DialogDescription className="sr-only">
          Type to fuzzy-search Stories on every Board. Use the arrow keys and Enter to open one.
        </DialogDescription>
        <div className="flex items-center gap-2 border-b px-3 pr-10">
          <SearchIcon className="size-4 shrink-0 text-muted-foreground" />
          <input
            ref={input}
            role="combobox"
            aria-expanded={results.length > 0}
            aria-controls="search-results"
            aria-activedescendant={results[active] ? `search-result-${active}` : undefined}
            aria-label="Search Stories"
            className="h-12 w-full min-w-0 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            placeholder="Search Stories…"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setHighlight(0);
            }}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                event.preventDefault();
                if (!results.length) return;
                const step = event.key === "ArrowDown" ? 1 : -1;
                setHighlight((active + step + results.length) % results.length);
              } else if (event.key === "Enter" && results[active]) {
                event.preventDefault();
                pick(results[active].key);
              }
            }}
          />
        </div>
        {results.length > 0 ? (
          <div id="search-results" role="listbox" aria-label="Stories" className="max-h-80 overflow-y-auto p-1">
            {results.map((r, i) => (
              // biome-ignore lint/a11y/useKeyWithClickEvents: the combobox input handles the keys (aria-activedescendant)
              <div
                key={r.key}
                id={`search-result-${i}`}
                ref={i === active ? (el) => el?.scrollIntoView({ block: "nearest" }) : undefined}
                role="option"
                tabIndex={-1}
                aria-selected={i === active}
                className={cn(
                  "flex cursor-pointer items-center gap-3 rounded-sm px-2 py-1.5 text-sm",
                  i === active && "bg-accent text-accent-foreground",
                )}
                onMouseMove={() => setHighlight(i)}
                onClick={() => pick(r.key)}
              >
                <span className="shrink-0 font-mono text-xs text-muted-foreground">{r.key}</span>
                <span className="min-w-0 flex-1 truncate">{r.title}</span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {r.board.name} · {r.stage.name}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p className="px-3 py-6 text-center text-sm text-muted-foreground">
            {!query.trim() ? "Type to search Stories on every Board." : isFetched ? "No Stories found" : "Searching…"}
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}

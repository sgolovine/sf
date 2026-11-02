import { useState } from "react";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { Markdown } from "./Markdown.tsx";

type Mode = "write" | "preview";

type Props = {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  rows?: number;
  /** Min-height class shared by the textarea and the preview. */
  minHeight?: string;
  placeholder?: string;
};

/** A labelled Write/Preview markdown editor. Opens on Preview when it has content; double-click the preview to edit. */
export function MarkdownEditor({
  id,
  label,
  value,
  onChange,
  rows = 8,
  minHeight = "min-h-40",
  placeholder = "Markdown supported",
}: Props) {
  const [mode, setMode] = useState<Mode>(value.trim() ? "preview" : "write");
  return (
    <Tabs value={mode} onValueChange={(v) => setMode(v as Mode)} className="gap-2">
      <div className="flex items-center justify-between">
        <Label htmlFor={id}>{label}</Label>
        <TabsList aria-label={`${label} mode`}>
          <TabsTrigger type="button" value="write">
            Write
          </TabsTrigger>
          <TabsTrigger type="button" value="preview">
            Preview
          </TabsTrigger>
        </TabsList>
      </div>
      <TabsContent value="write">
        <Textarea
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          rows={rows}
          className={cn(minHeight, "font-mono")}
          placeholder={placeholder}
        />
      </TabsContent>
      <TabsContent value="preview">
        {/* biome-ignore lint/a11y/noStaticElementInteractions: double-click shortcut; the Write tab is the accessible path */}
        <div
          className={cn(minHeight, "cursor-text rounded-md border px-3 py-2")}
          onDoubleClick={() => setMode("write")}
          title="Double-click to edit"
        >
          {value.trim() ? (
            <Markdown>{value}</Markdown>
          ) : (
            <p className="text-sm text-muted-foreground">Nothing to preview.</p>
          )}
        </div>
      </TabsContent>
    </Tabs>
  );
}

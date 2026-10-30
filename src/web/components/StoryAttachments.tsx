import { useEffect } from "react";
import { useDropzone } from "react-dropzone";
import { ATTACHMENT_BATCH_LIMIT, ATTACHMENT_COUNT_LIMIT, ATTACHMENT_LIMIT, type Attachment } from "#model/attachment";
import { sfApi } from "../api/client.ts";
import { Button } from "./ui/button.tsx";

export async function encodeAttachments(files: File[]) {
  return Promise.all(
    files.map(async (file) => ({
      name: file.name,
      mediaType: file.type,
      data: await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(new Error(`Cannot read ${file.name}`));
        reader.onload = () => resolve(String(reader.result).split(",")[1]!);
        reader.readAsDataURL(file);
      }),
    })),
  );
}

export function StoryAttachments({
  storyKey,
  persisted,
  pending,
  setPending,
  error,
  setError,
  disabled,
}: {
  storyKey?: string;
  persisted: Attachment[];
  pending: File[];
  setPending: React.Dispatch<React.SetStateAction<File[]>>;
  error: string;
  setError: (message: string) => void;
  disabled: boolean;
}) {
  const add = (files: File[]) => {
    if (disabled) return;
    if (
      pending.length + files.length > ATTACHMENT_COUNT_LIMIT ||
      files.some((f) => f.size > ATTACHMENT_LIMIT) ||
      pending.reduce((n, f) => n + f.size, 0) + files.reduce((n, f) => n + f.size, 0) > ATTACHMENT_BATCH_LIMIT
    ) {
      setError("Choose files up to 20 MiB each, with at most 40 MiB and 100 files per save.");
      return;
    }
    setError("");
    setPending((current) => [...current, ...files]);
  };
  const { getRootProps, getInputProps, isDragActive } = useDropzone({ onDrop: add, disabled, multiple: true });
  useEffect(() => {
    const paste = (event: ClipboardEvent) => {
      const files = Array.from(event.clipboardData?.items ?? [])
        .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
        .map((item) => item.getAsFile())
        .filter((file): file is File => Boolean(file))
        .map((file) =>
          file.name.trim() && !["image", "blob"].includes(file.name)
            ? file
            : new File(
                [file],
                `clipboard-${crypto.randomUUID()}.${({ "image/jpeg": "jpg", "image/svg+xml": "svg" } as Record<string, string>)[file.type] ?? file.type.split("/")[1] ?? "png"}`,
                { type: file.type },
              ),
        );
      if (files.length) add(files);
    };
    window.addEventListener("paste", paste);
    return () => window.removeEventListener("paste", paste);
  });
  return (
    <section className="grid gap-2" aria-label="Attachments">
      <p className="text-sm font-medium">Attachments</p>
      <div
        {...getRootProps({
          className: "rounded-md border border-dashed p-4 text-sm cursor-pointer",
          "aria-label": "Add attachments",
        })}
      >
        <input {...getInputProps({ "aria-label": "Choose attachment files" })} />
        {isDragActive ? "Drop files here" : "Drop files or click to choose. Paste images anywhere in this editor."}
        <p className="mt-1 text-xs text-muted-foreground">20 MiB per file · 40 MiB / 100 files per save</p>
      </div>
      {persisted.map((file) => (
        <div className="flex items-center justify-between gap-2 text-sm" key={file.id}>
          <span>
            {file.name} ({formatSize(file.size)}) · Saved
          </span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              if (storyKey) void sfApi.downloadAttachment(storyKey, file).catch((err: Error) => setError(err.message));
            }}
          >
            Download
          </Button>
        </div>
      ))}
      {pending.map((file, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: pending rows have no local state and deliberately allow duplicate files.
        <div className="flex items-center justify-between gap-2 text-sm" key={`${file.name}-${index}`}>
          <span>
            {file.name} ({formatSize(file.size)}) · Pending
          </span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={disabled}
            onClick={() => setPending((files) => files.filter((_, i) => i !== index))}
            aria-label={`Remove ${file.name}`}
          >
            Remove
          </Button>
        </div>
      ))}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </section>
  );
}

function formatSize(bytes: number) {
  return bytes < 1024
    ? `${bytes} bytes`
    : bytes < 1024 * 1024
      ? `${(bytes / 1024).toFixed(1)} KiB`
      : `${(bytes / 1024 / 1024).toFixed(1)} MiB`;
}

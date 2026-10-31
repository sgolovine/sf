import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { sfApi } from "../api/client.ts";

/** Creates a Board (and the Project, if needed) with the default Stages. */
export function CreateBoard({
  onCreated,
  onClose,
  onRestoreFocus,
}: {
  onCreated: (id: string) => void;
  onClose: () => void;
  onRestoreFocus: () => void;
}) {
  const [name, setName] = useState("");
  const [key, setKey] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pending = useRef(false);
  const nameInput = useRef<HTMLInputElement>(null);
  return (
    <Dialog open onOpenChange={(open) => !open && !pending.current && onClose()}>
      <DialogContent
        className="max-h-[90svh] overflow-y-auto sm:max-w-md"
        showCloseButton={!submitting}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          nameInput.current?.focus();
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          onRestoreFocus();
        }}
        onEscapeKeyDown={(event) => pending.current && event.preventDefault()}
        onInteractOutside={(event) => pending.current && event.preventDefault()}
      >
        <form
          className="grid gap-4"
          aria-busy={submitting}
          onSubmit={async (event) => {
            event.preventDefault();
            if (pending.current || !name.trim() || !key.trim()) return;
            pending.current = true;
            setSubmitting(true);
            setError(null);
            try {
              const board = await sfApi.createBoard(name, key);
              onCreated(board.id);
            } catch (err) {
              setError(err instanceof Error ? err.message : String(err));
            } finally {
              pending.current = false;
              setSubmitting(false);
            }
          }}
        >
          <DialogHeader>
            <DialogTitle>Create a Board</DialogTitle>
            <DialogDescription>It starts with Backlog, TODO, In Progress, In Review, and Done.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor="board-name">Name</Label>
            <Input
              ref={nameInput}
              id="board-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Development"
              disabled={submitting}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="board-key">Key</Label>
            <Input
              id="board-key"
              value={key}
              onChange={(event) => setKey(event.target.value.toUpperCase())}
              placeholder="DEV"
              disabled={submitting}
            />
          </div>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={submitting}>
              Cancel
            </Button>
            <Button type="submit" disabled={submitting || !name.trim() || !key.trim()}>
              {submitting ? "Creating…" : "Create Board"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

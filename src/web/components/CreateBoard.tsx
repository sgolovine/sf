import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { sfApi } from "../api/client.ts";
import type { Act } from "./ErrorBanner.tsx";

/** Creates a Board (and the Project, if needed) with the default Stages. */
export function CreateBoard({
  act,
  onCreated,
  onCancel,
}: {
  act: Act;
  onCreated: (id: string) => void;
  onCancel?: () => void;
}) {
  const [name, setName] = useState("");
  const [key, setKey] = useState("");
  return (
    <div className="p-6">
      <Card className="mx-auto max-w-md">
        <form
          className="contents"
          onSubmit={async (e) => {
            e.preventDefault();
            let id = "";
            if (await act(async () => (id = (await sfApi.createBoard(name, key)).id))) onCreated(id);
          }}
        >
          <CardHeader>
            <CardTitle>Create a Board</CardTitle>
            <CardDescription>It starts with Backlog, TODO, In Progress, In Review, and Done.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="grid gap-2">
              <Label htmlFor="board-name">Name</Label>
              <Input
                id="board-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Development"
                autoFocus
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="board-key">Key</Label>
              <Input
                id="board-key"
                value={key}
                onChange={(e) => setKey(e.target.value.toUpperCase())}
                placeholder="DEV"
              />
            </div>
          </CardContent>
          <CardFooter className="justify-end gap-2">
            {onCancel && (
              <Button type="button" variant="outline" onClick={onCancel}>
                Cancel
              </Button>
            )}
            <Button type="submit" disabled={!name.trim() || !key.trim()}>
              Create Board
            </Button>
          </CardFooter>
        </form>
      </Card>
    </div>
  );
}

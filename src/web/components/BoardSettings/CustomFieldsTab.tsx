import { useState } from "react";
import { FIELD_TYPES, type BoardSnapshot, type FieldDef, type FieldType } from "#protocol";
import { Plus, X } from "lucide-react";
import { sfApi } from "../../api/client.ts";
import type { Act } from "../ErrorBanner.tsx";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

type Row = { id: string; name: string; type: FieldType; options: string };

const toRows = (schema: FieldDef[]): Row[] =>
  schema.map((f) => ({ id: f.id, name: f.name, type: f.type, options: (f.options ?? []).join(", ") }));

/** Edits the Board's Story schema (custom fields). */
export function CustomFieldsTab({ board, act }: { board: BoardSnapshot; act: Act }) {
  const [rows, setRows] = useState<Row[]>(() => toRows(board.config.schema));
  const set = (i: number, patch: Partial<Row>) => setRows(rows.map((r, j) => (i === j ? { ...r, ...patch } : r)));

  const save = () => {
    const schema: FieldDef[] = rows.map((r) => ({
      id: r.id.trim(),
      name: r.name.trim(),
      type: r.type,
      ...(r.type.endsWith("select")
        ? {
            options: r.options
              .split(",")
              .map((o) => o.trim())
              .filter(Boolean),
          }
        : {}),
    }));
    void act(() => sfApi.updateBoard(board.id, { schema }));
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Custom Fields</CardTitle>
        <CardDescription>Fields every Story on {board.config.name} can carry. Options apply to the select types.</CardDescription>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">No custom fields.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Id</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Options</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r, i) => (
                <TableRow key={i}>
                  <TableCell>
                    <Input value={r.id} onChange={(e) => set(i, { id: e.target.value })} placeholder="priority" aria-label="Field id" />
                  </TableCell>
                  <TableCell>
                    <Input value={r.name} onChange={(e) => set(i, { name: e.target.value })} placeholder="Priority" aria-label="Field name" />
                  </TableCell>
                  <TableCell>
                    <Select value={r.type} onValueChange={(v) => set(i, { type: v as FieldType })}>
                      <SelectTrigger className="w-36" aria-label="Field type">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {FIELD_TYPES.map((t) => (
                          <SelectItem key={t} value={t}>
                            {t}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell>
                    <Input
                      value={r.options}
                      disabled={!r.type.endsWith("select")}
                      onChange={(e) => set(i, { options: e.target.value })}
                      placeholder="low, high"
                      aria-label="Field options"
                    />
                  </TableCell>
                  <TableCell>
                    <Button variant="ghost" size="icon-sm" onClick={() => setRows(rows.filter((_, j) => j !== i))} aria-label="Remove field">
                      <X />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
      <CardFooter className="justify-end gap-2">
        <Button variant="outline" onClick={() => setRows([...rows, { id: "", name: "", type: "text", options: "" }])}>
          <Plus /> Add field
        </Button>
        <Button onClick={save}>Save fields</Button>
      </CardFooter>
    </Card>
  );
}

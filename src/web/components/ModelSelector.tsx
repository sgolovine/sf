import { useId } from "react";
import { type ModelOption, modelDescription, type ResolvedModel } from "#model/models";
import { Label } from "@/components/ui/label";

type Props = {
  value: string;
  onChange: (value: string) => void;
  options: ModelOption[];
  effective: ResolvedModel;
  defaultLabel?: string;
  disabled?: boolean;
};

/** A native select preserves exact slugs, including saved values missing from the catalog. */
export function ModelSelector({ value, onChange, options, effective, defaultLabel = "Inherit", disabled }: Props) {
  const id = useId();
  const choices = [...options];
  if (value && !choices.some((o) => o.slug === value)) choices.push({ slug: value, label: value });
  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>Worker model</Label>
      <select
        id={id}
        className="h-9 w-full rounded-md border bg-background px-3 text-sm"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        aria-describedby={`${id}-effective`}
      >
        <option value="">{defaultLabel}</option>
        {choices.map((o) => (
          <option key={o.slug} value={o.slug}>
            {o.label} · {o.slug}
          </option>
        ))}
      </select>
      <p id={`${id}-effective`} className="text-sm text-muted-foreground">
        {value ? "Selected" : "Inherited"}: {modelDescription(effective)}
      </p>
    </div>
  );
}

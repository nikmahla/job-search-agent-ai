"use client";

import { Plus, X } from "lucide-react";
import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function TagInput({ label, values, onChange, placeholder }: { label: string; values: string[]; onChange: (values: string[]) => void; placeholder: string }) {
  const id = useId();
  const [draft, setDraft] = useState("");
  const add = () => {
    const value = draft.trim();
    if (value && !values.some((existing) => existing.toLowerCase() === value.toLowerCase())) onChange([...values, value]);
    setDraft("");
  };
  return (
    <div className="space-y-2.5">
      <Label htmlFor={id}>{label}</Label>
      <ul className="flex flex-wrap gap-2" aria-label={label}>
        {values.map((value) => (
          <li key={value} className="flex items-center gap-1 rounded-full border bg-card py-1 pl-3 pr-1 text-sm">
            {value}
            <button type="button" onClick={() => onChange(values.filter((item) => item !== value))} aria-label={`Remove ${value}`} className="grid size-6 place-items-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground">
              <X className="size-3.5" aria-hidden />
            </button>
          </li>
        ))}
        {values.length === 0 ? <li className="text-sm text-muted-foreground">None yet</li> : null}
      </ul>
      <div className="flex gap-2">
        <Input id={id} value={draft} placeholder={placeholder} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); add(); } }} />
        <Button type="button" variant="outline" onClick={add} disabled={!draft.trim()}>
          <Plus className="size-4" aria-hidden /> Add
        </Button>
      </div>
    </div>
  );
}

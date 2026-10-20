"use client";

import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { Preferences } from "@/lib/schema";
import { TagInput } from "./tag-input";

export function StepPreferences({ value, onChange }: { value: Preferences; onChange: (value: Preferences) => void }) {
  const set = <K extends keyof Preferences>(key: K, next: Preferences[K]) => onChange({ ...value, [key]: next });
  return (
    <div className="space-y-8">
      <TagInput label="Roles to search for" values={value.targetRoles} onChange={(next) => set("targetRoles", next)} placeholder="e.g. Frontend Engineer" />
      <TagInput label="Cities where you can work onsite or hybrid" values={value.acceptedCities} onChange={(next) => set("acceptedCities", next)} placeholder="e.g. Alicante" />

      <div className="grid grid-cols-1 gap-8 sm:grid-cols-2">
        <div className="space-y-2.5">
          <Label id="modes-label">Work modes</Label>
          <ToggleGroup type="multiple" variant="outline" value={value.workModes} onValueChange={(next) => set("workModes", next as Preferences["workModes"])} aria-labelledby="modes-label" className="flex-wrap justify-start">
            {(["remote", "hybrid", "onsite"] as const).map((mode) => (
              <ToggleGroupItem key={mode} value={mode} className="px-4 capitalize">{mode}</ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>
        <div className="space-y-2.5">
          <Label id="scopes-label">Remote jobs open to</Label>
          <ToggleGroup type="multiple" variant="outline" value={value.remoteScopes} onValueChange={(next) => set("remoteScopes", next as Preferences["remoteScopes"])} aria-labelledby="scopes-label" className="flex-wrap justify-start">
            {([["spain", "Spain"], ["europe", "Europe"], ["uk", "United Kingdom"]] as const).map(([key, label]) => (
              <ToggleGroupItem key={key} value={key} className="px-4">{label}</ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>
      </div>

      <div className="space-y-3">
        <div className="flex items-baseline justify-between">
          <Label htmlFor="pref-min">Hide jobs scoring below</Label>
          <span className="tabular text-sm font-medium">{value.minScore}</span>
        </div>
        <Slider id="pref-min" min={0} max={90} step={5} value={[value.minScore]} onValueChange={([next]) => set("minScore", next)} aria-label="Minimum score to show" />
        <p className="text-sm text-muted-foreground">Apply starts at 75 and review at 60.</p>
      </div>

      <div className="flex items-start justify-between gap-6 rounded-xl border bg-card p-4">
        <div>
          <Label htmlFor="pref-senior" className="text-base">Include senior roles</Label>
          <p className="mt-1 max-w-md text-sm text-muted-foreground">Senior titles are judged on skills and experience. Lead, principal, staff and intern roles are always left out.</p>
        </div>
        <Switch id="pref-senior" checked={value.includeSenior} onCheckedChange={(next) => set("includeSenior", next)} />
      </div>
    </div>
  );
}

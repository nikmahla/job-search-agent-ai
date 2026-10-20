"use client";

import { Plus, Quote, X } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { CandidateProfile } from "@/lib/schema";

const GROUP_LABEL: Record<string, string> = {
  primary: "Core skills",
  secondary: "Also used",
  testing: "Testing",
  performance: "Performance",
  tools: "Tools",
  practices: "Practices"
};

export function StepProfile({ profile, onChange }: { profile: CandidateProfile; onChange: (profile: CandidateProfile) => void }) {
  const [skill, setSkill] = useState("");
  const [line, setLine] = useState("");

  const remove = (group: string, name: string) =>
    onChange({
      ...profile,
      skills: { ...profile.skills, [group]: profile.skills[group].filter((item) => item !== name) },
      cvEvidence: Object.fromEntries(Object.entries(profile.cvEvidence).filter(([key]) => key !== name))
    });

  const add = () => {
    const name = skill.trim();
    const evidence = line.trim();
    if (!name || !evidence) return;
    onChange({
      ...profile,
      skills: { ...profile.skills, secondary: [...(profile.skills.secondary ?? []), name] },
      cvEvidence: { ...profile.cvEvidence, [name]: evidence }
    });
    setSkill("");
    setLine("");
  };

  return (
    <div className="space-y-8">
      <div className="grid grid-cols-1 gap-x-8 gap-y-4 sm:grid-cols-3">
        <div>
          <p className="text-sm text-muted-foreground">Name</p>
          <p className="font-semibold">{profile.candidate.name} <span className="text-sm font-normal text-muted-foreground">(sample)</span></p>
        </div>
        <div>
          <p className="text-sm text-muted-foreground">Experience</p>
          <p className="tabular font-semibold">{profile.candidate.experienceYears} years</p>
        </div>
        <div>
          <p className="text-sm text-muted-foreground">Languages</p>
          <p className="font-semibold">{profile.candidate.languages.map((language) => `${language.language} ${language.level}`).join(" · ")}</p>
        </div>
      </div>

      <div>
        <h3 className="text-lg font-semibold">Skills found in your CV</h3>
        <p className="mt-1 text-sm text-muted-foreground">Hover or focus a skill to see the line it came from. Remove anything that is wrong.</p>
        <div className="mt-5 space-y-5">
          {Object.entries(profile.skills).map(([group, names]) => (
            <div key={group}>
              <p className="text-sm font-medium text-muted-foreground">{GROUP_LABEL[group] ?? group}</p>
              <ul className="mt-2 flex flex-wrap gap-2">
                {names.map((name) => (
                  <li key={name} className="flex items-center rounded-full border bg-card text-sm">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button type="button" className="flex items-center gap-1.5 rounded-l-full py-1 pl-3 pr-1.5">
                          {name}
                          {profile.cvEvidence[name] ? <Quote className="size-3 text-brand" aria-hidden /> : null}
                          <span className="sr-only">{profile.cvEvidence[name] ? `Evidence: ${profile.cvEvidence[name]}` : "No quoted evidence"}</span>
                        </button>
                      </TooltipTrigger>
                      <TooltipContent className="evidence-quote max-w-xs text-base">
                        {profile.cvEvidence[name] ? `“${profile.cvEvidence[name]}”` : "Listed in your skills section; no sentence quoted."}
                      </TooltipContent>
                    </Tooltip>
                    <button type="button" onClick={() => remove(group, name)} aria-label={`Remove ${name}`} className="mr-1 grid size-6 place-items-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground">
                      <X className="size-3.5" aria-hidden />
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>

      <fieldset className="rounded-xl border bg-card p-4 sm:p-5">
        <legend className="px-1 text-sm font-semibold">Add a skill the reader missed</legend>
        <p className="mb-4 text-sm text-muted-foreground">A skill needs the CV line that shows it. Shortlist does not score skills it cannot point to.</p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_2fr_auto] sm:items-end">
          <div className="space-y-1.5">
            <Label htmlFor="new-skill">Skill</Label>
            <Input id="new-skill" value={skill} onChange={(event) => setSkill(event.target.value)} placeholder="e.g. Playwright" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="new-line">Line from your CV</Label>
            <Input id="new-line" value={line} onChange={(event) => setLine(event.target.value)} placeholder="Wrote end-to-end tests with Playwright" />
          </div>
          <Button type="button" variant="outline" onClick={add} disabled={!skill.trim() || !line.trim()}>
            <Plus className="size-4" aria-hidden /> Add skill
          </Button>
        </div>
      </fieldset>
    </div>
  );
}

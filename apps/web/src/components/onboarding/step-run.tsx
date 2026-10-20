"use client";

import { Check, Loader2 } from "lucide-react";
import { FitGlyph } from "@/components/shared/fit-glyph";
import type { SearchProgress, SearchStage } from "@/lib/api";
import type { Preferences } from "@/lib/schema";

const STAGES: { stage: SearchStage; label: string }[] = [
  { stage: "discover", label: "Search the job sources" },
  { stage: "filter", label: "Filter by title and framework" },
  { stage: "pre-rank", label: "Rank by location, role and seniority" },
  { stage: "enrich", label: "Read full descriptions" },
  { stage: "analyse", label: "Extract requirements" },
  { stage: "score", label: "Score against your profile" }
];

export function StepRun({ preferences, progress, running, done }: { preferences: Preferences; progress: SearchProgress | null; running: boolean; done: boolean }) {
  const reachedIndex = progress ? STAGES.findIndex((item) => item.stage === progress.stage) : -1;
  return (
    <div className="space-y-8">
      <dl className="grid grid-cols-1 gap-x-8 gap-y-4 sm:grid-cols-2">
        <div>
          <dt className="text-sm text-muted-foreground">Searching for</dt>
          <dd className="font-medium">{preferences.targetRoles.join(", ") || "No roles chosen"}</dd>
        </div>
        <div>
          <dt className="text-sm text-muted-foreground">Onsite or hybrid in</dt>
          <dd className="font-medium">{preferences.acceptedCities.join(", ") || "No city"}</dd>
        </div>
        <div>
          <dt className="text-sm text-muted-foreground">Work modes</dt>
          <dd className="font-medium capitalize">{preferences.workModes.join(", ") || "None"}</dd>
        </div>
        <div>
          <dt className="text-sm text-muted-foreground">Remote open to</dt>
          <dd className="font-medium capitalize">{preferences.remoteScopes.join(", ") || "None"}</dd>
        </div>
      </dl>

      <ol aria-label="Search progress" className="space-y-1">
        {STAGES.map((item, index) => {
          // A progress event is emitted when a stage finishes, so the stage after it is the one running.
          const complete = done || index <= reachedIndex;
          const current = running && !complete && index === reachedIndex + 1;
          return (
            <li key={item.stage} className="flex items-center gap-3 rounded-lg px-3 py-2.5" aria-current={current ? "step" : undefined}>
              <span className="grid size-6 place-items-center">
                {complete ? <Check className="size-4 text-match" aria-hidden /> : current ? <Loader2 className="size-4 animate-spin text-brand" aria-hidden /> : <FitGlyph status="UNKNOWN" size={12} />}
              </span>
              <span className={complete ? "text-foreground" : current ? "font-medium" : "text-muted-foreground"}>{item.label}</span>
            </li>
          );
        })}
      </ol>
      <p aria-live="polite" className="min-h-6 text-sm text-muted-foreground">
        {done ? "Done. 12 demo jobs are ready to review." : progress?.message ?? (running ? "Starting…" : "Nothing is searched in this demo; the run replays a saved example.")}
      </p>
    </div>
  );
}

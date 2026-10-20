import { MapPin } from "lucide-react";
import Link from "next/link";
import { DecisionBadge } from "@/components/shared/decision-badge";
import { ScoreRing } from "@/components/shared/score-ring";
import { Badge } from "@/components/ui/badge";
import { concerns, jobHref, matchedSkills, SOURCE_LABEL, workMode } from "@/lib/job-helpers";
import type { JobResult } from "@/lib/schema";
import { SaveButton } from "./save-button";

export function JobRow({ job }: { job: JobResult }) {
  const matches = matchedSkills(job);
  const issues = concerns(job);
  return (
    <article className="group relative flex gap-4 p-4 transition-colors hover:bg-accent/40 sm:gap-5 sm:p-5">
      <ScoreRing score={job.jobFitScore} decision={job.decision} size={64} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <h3 className="text-base font-semibold sm:text-lg">
            <Link href={jobHref(job)} className="after:absolute after:inset-0 after:content-[''] focus-visible:outline-none">
              {job.title}
            </Link>
          </h3>
          <DecisionBadge decision={job.decision} />
        </div>
        <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-sm text-muted-foreground">
          <span>{job.company}</span>
          <span aria-hidden>·</span>
          <span className="inline-flex items-center gap-1">
            <MapPin className="size-3.5" aria-hidden />
            {job.sourceInfo.location}
          </span>
        </p>
        <div className="mt-2.5 flex flex-wrap items-center gap-1.5 text-xs">
          <Badge variant="secondary" className="rounded-full">{workMode(job)}</Badge>
          <Badge variant="secondary" className="rounded-full">{SOURCE_LABEL[job.sourceInfo.source]}</Badge>
        </div>
        <dl className="mt-3 grid grid-cols-1 gap-1.5 text-sm sm:grid-cols-[auto_1fr] sm:gap-x-3">
          <dt className="text-muted-foreground">Matches</dt>
          <dd className="text-pretty">{matches.length ? matches.join(", ") : "No matching skills found"}</dd>
          <dt className="text-muted-foreground">Concerns</dt>
          <dd className="text-pretty">{issues.length ? issues.join(" · ") : "None found"}</dd>
        </dl>
      </div>
      <SaveButton stateKey={job.stateKey} title={job.title} className="self-start" />
    </article>
  );
}

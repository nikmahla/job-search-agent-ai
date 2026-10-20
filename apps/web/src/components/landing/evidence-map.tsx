"use client";

import { motion, useReducedMotion } from "framer-motion";
import { useState } from "react";
import { FitGlyph, glyphLabel } from "@/components/shared/fit-glyph";
import { ScoreRing } from "@/components/shared/score-ring";
import { demoJobs } from "@/demo-data/jobs";
import { cvQuoteFor } from "@/lib/evidence";
import { cn } from "@/lib/utils";

const job = demoJobs.find((candidate) => candidate.stateKey.endsWith("frontend-engineer-design-systems")) ?? demoJobs[0];

/**
 * The landing page's one moving part: a posting on the left, the CV line that answers each
 * requirement on the right. Connectors draw in once on load; hovering or focusing a row
 * isolates it. Gaps are shown as an empty slot, never papered over.
 */
export function EvidenceMap() {
  const reduce = useReducedMotion();
  const [active, setActive] = useState<number | null>(null);

  return (
    <figure className="rounded-2xl border bg-card p-4 shadow-sm sm:p-6" aria-label={`Example: how ${job.title} is checked against a CV`}>
      <figcaption className="flex items-center gap-4 border-b pb-4">
        <ScoreRing score={job.jobFitScore} decision={job.decision} size={56} stroke={5} />
        <div className="min-w-0">
          <p className="truncate font-semibold">{job.title}</p>
          <p className="truncate text-sm text-muted-foreground">
            {job.company} · {job.sourceInfo.location}
          </p>
        </div>
      </figcaption>

      <ul className="mt-2 divide-y divide-border/70" onMouseLeave={() => setActive(null)}>
        {job.coverage.map((row, index) => {
          const evidence = row.evidence[0] ? cvQuoteFor(row.evidence[0]) : null;
          const dimmed = active !== null && active !== index;
          return (
            <li key={row.requirement}>
              <button
                type="button"
                onMouseEnter={() => setActive(index)}
                onFocus={() => setActive(index)}
                onBlur={() => setActive(null)}
                aria-label={`${row.requirement}: ${glyphLabel(row.status)}`}
                className={cn(
                  "grid w-full grid-cols-[minmax(0,1fr)_2.5rem_minmax(0,1fr)] items-center gap-2 rounded-lg px-1 py-3.5 text-left transition-opacity duration-200 sm:grid-cols-[minmax(0,1fr)_4rem_minmax(0,1fr)]",
                  dimmed && "opacity-40"
                )}
              >
                <span className="flex items-start gap-2.5 text-sm font-medium">
                  <span className="mt-0.5">
                    <FitGlyph status={row.status} />
                  </span>
                  <span className="text-pretty">{row.requirement}</span>
                </span>
                <svg viewBox="0 0 64 8" preserveAspectRatio="none" className="h-2 w-full" aria-hidden>
                  <motion.line
                    x1="0"
                    y1="4"
                    x2="64"
                    y2="4"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    vectorEffect="non-scaling-stroke"
                    className={evidence ? "stroke-brand" : "stroke-muted-foreground/60"}
                    initial={reduce ? false : { pathLength: 0 }}
                    animate={{ pathLength: 1 }}
                    transition={{ delay: 0.5 + index * 0.18, duration: 0.55, ease: "easeOut" }}
                  />
                </svg>
                <span className="text-sm">
                  {evidence ? (
                    <span className={cn("evidence-quote block text-pretty", row.status === "PARTIAL" && "text-foreground/70")}>“{evidence.quote}”</span>
                  ) : (
                    <span className="block rounded-md border border-dashed px-2.5 py-1.5 text-muted-foreground">Not in your CV</span>
                  )}
                  {row.status === "PARTIAL" && row.note === "" ? (
                    <span className="mt-1 block text-xs text-partial">Partly covered</span>
                  ) : null}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      <p className="mt-3 text-xs text-muted-foreground">Synthetic posting and CV, for demonstration.</p>
    </figure>
  );
}

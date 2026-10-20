"use client";

import { motion, useReducedMotion } from "framer-motion";
import { FitGlyph } from "@/components/shared/fit-glyph";
import { demoJobs } from "@/demo-data/jobs";
import { BREAKDOWN_KEYS, BREAKDOWN_LABELS, BREAKDOWN_WEIGHTS, GATE_KEYS, GATE_LABELS } from "@/lib/schema";

const job = demoJobs[0];

/** Shows the real shape of a score: five weighted parts, then five yes/no/review gates. */
export function ScoreAnatomy() {
  const reduce = useReducedMotion();
  return (
    <div className="grid grid-cols-1 gap-8 sm:grid-cols-2">
      <div>
        <h3 className="text-sm font-semibold text-muted-foreground">Weighted parts</h3>
        <ul className="mt-4 space-y-4">
          {BREAKDOWN_KEYS.map((key) => {
            const value = job.breakdown[key];
            return (
              <li key={key}>
                <div className="flex items-baseline justify-between text-sm">
                  <span className="font-medium">{BREAKDOWN_LABELS[key]}</span>
                  <span className="tabular text-muted-foreground">
                    {value === null ? "no data" : value} · weight {Math.round(BREAKDOWN_WEIGHTS[key] * 100)}%
                  </span>
                </div>
                <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-muted">
                  <motion.div
                    className="h-full rounded-full bg-brand"
                    initial={reduce ? false : { width: 0 }}
                    whileInView={{ width: `${value ?? 0}%` }}
                    viewport={{ once: true, margin: "-60px" }}
                    transition={{ duration: 0.8, ease: "easeOut" }}
                  />
                </div>
              </li>
            );
          })}
        </ul>
        <p className="mt-4 text-sm text-muted-foreground">Parts with no data are left out, not counted as zero.</p>
      </div>
      <div>
        <h3 className="text-sm font-semibold text-muted-foreground">Gates that must be confirmed</h3>
        <ul className="mt-4 space-y-3">
          {GATE_KEYS.map((key) => (
            <li key={key} className="flex items-start gap-3 text-sm">
              <span className="mt-0.5">
                <FitGlyph status={job.gates[key].status} />
              </span>
              <span>
                <span className="font-medium">{GATE_LABELS[key]}</span>
                <span className="block text-muted-foreground">{job.gates[key].note}</span>
              </span>
            </li>
          ))}
        </ul>
        <p className="mt-4 text-sm text-muted-foreground">A gate that is not confirmed keeps a job in review instead of guessing.</p>
      </div>
    </div>
  );
}

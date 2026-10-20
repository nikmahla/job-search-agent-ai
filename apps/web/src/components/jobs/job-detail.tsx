"use client";

import { ArrowLeft, ExternalLink, MapPin } from "lucide-react";
import Link from "next/link";
import { BreakdownRadar } from "@/components/charts/breakdown-radar";
import { DecisionBadge } from "@/components/shared/decision-badge";
import { FitGlyph, glyphLabel } from "@/components/shared/fit-glyph";
import { ScoreRing } from "@/components/shared/score-ring";
import { EmptyState, ErrorState, LoadingRows } from "@/components/shared/state-views";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cvQuoteFor } from "@/lib/evidence";
import { formatDate, SOURCE_LABEL, workMode } from "@/lib/job-helpers";
import { useJob } from "@/lib/query/hooks";
import { BREAKDOWN_KEYS, BREAKDOWN_LABELS, BREAKDOWN_WEIGHTS, GATE_KEYS, GATE_LABELS, type CoverageRow, type JobResult } from "@/lib/schema";
import { SaveButton } from "./save-button";

function RequirementLedger({ title, rows }: { title: string; rows: CoverageRow[] }) {
  if (!rows.length) return null;
  return (
    <section aria-label={title}>
      <h3 className="text-sm font-semibold text-muted-foreground">{title}</h3>
      <ul className="mt-3 divide-y divide-border rounded-xl border bg-card">
        {rows.map((row) => {
          const quotes = row.evidence.map(cvQuoteFor);
          return (
            <li key={row.requirement} className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] sm:gap-6">
              <div className="flex items-start gap-3">
                <span className="mt-1"><FitGlyph status={row.status} /></span>
                <div>
                  <p className="font-medium text-pretty">{row.requirement}</p>
                  <p className="mt-0.5 text-sm text-muted-foreground">{glyphLabel(row.status)}</p>
                </div>
              </div>
              <div className="text-sm">
                {quotes.length ? (
                  <ul className="space-y-2">
                    {quotes.slice(0, 2).map((quote) => (
                      <li key={quote.quote}>
                        <span className="evidence-quote block text-pretty">“{quote.quote}”</span>
                        <span className="text-xs text-muted-foreground">{quote.source}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-muted-foreground">{row.status === "GAP" ? "Nothing in your profile covers this." : "No evidence to quote."}</p>
                )}
                {row.note ? <p className="mt-2 text-pretty text-partial">{row.note}</p> : null}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function Detail({ job }: { job: JobResult }) {
  const required = job.coverage.filter((row) => row.kind === "Required");
  const preferred = job.coverage.filter((row) => row.kind === "Preferred");
  const counts = job.coverage.reduce<Record<string, number>>((acc, row) => ({ ...acc, [row.status]: (acc[row.status] ?? 0) + 1 }), {});

  return (
    <div>
      <Button asChild variant="ghost" size="sm" className="-ml-2 mb-4">
        <Link href="/jobs"><ArrowLeft className="size-4" aria-hidden /> All jobs</Link>
      </Button>

      <header className="flex flex-wrap items-start justify-between gap-6 border-b pb-8">
        <div className="max-w-2xl">
          <div className="flex flex-wrap items-center gap-2">
            <DecisionBadge decision={job.decision} />
            <Badge variant="secondary" className="rounded-full">{workMode(job)}</Badge>
            <Badge variant="secondary" className="rounded-full">{SOURCE_LABEL[job.sourceInfo.source]}</Badge>
          </div>
          <h1 className="mt-3 text-3xl font-semibold sm:text-4xl">{job.title}</h1>
          <p className="mt-2 flex flex-wrap items-center gap-x-2 text-muted-foreground">
            <span>{job.company}</span>
            <span aria-hidden>·</span>
            <span className="inline-flex items-center gap-1"><MapPin className="size-4" aria-hidden />{job.sourceInfo.location}</span>
            <span aria-hidden>·</span>
            <span>Posted {formatDate(job.sourceInfo.created)}</span>
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <SaveButton stateKey={job.stateKey} title={job.title} withLabel />
          <Button asChild>
            <a href={job.sourceInfo.url} target="_blank" rel="noopener noreferrer">
              Open original posting <ExternalLink className="size-4" aria-hidden />
            </a>
          </Button>
        </div>
      </header>

      <div className="mt-8 grid grid-cols-1 gap-10 lg:grid-cols-[1fr_20rem]">
        <div className="space-y-8">
          <section aria-label="Why this recommendation">
            <h2 className="text-xl font-semibold">Why {job.decision === "APPLY" ? "apply" : job.decision === "MAYBE" ? "review" : "skip"}</h2>
            <ul className="mt-3 space-y-2">
              {job.decisionReasons.map((reason) => (
                <li key={reason} className="rounded-lg border-l-4 border-brand bg-brand-soft/60 px-4 py-3 text-pretty">{reason}</li>
              ))}
            </ul>
          </section>

          <section aria-label="Requirements checked against your CV">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-xl font-semibold">Requirements checked against your CV</h2>
              <p className="tabular text-sm text-muted-foreground">
                {counts.MATCH ?? 0} match · {counts.PARTIAL ?? 0} partial · {counts.GAP ?? 0} gap · {counts.UNKNOWN ?? 0} to judge yourself
              </p>
            </div>
            <div className="mt-4 space-y-6">
              <RequirementLedger title="Required" rows={required} />
              <RequirementLedger title="Preferred" rows={preferred} />
            </div>
            <p className="mt-3 text-sm text-muted-foreground">Evidence is quoted only from your profile. Anything it cannot back up is shown as a gap, never assumed.</p>
          </section>

          <section aria-label="Posting excerpt">
            <h2 className="text-xl font-semibold">From the posting</h2>
            <blockquote className="evidence-quote mt-3 border-l-2 pl-4 text-lg text-pretty">{job.excerpt}</blockquote>
          </section>

          {job.extraction.status !== "complete" ? (
            <p role="note" className="rounded-lg border border-partial/40 bg-partial-soft px-4 py-3 text-partial">
              The posting was only partly understood ({job.extraction.warnings.join("; ") || "some fields were empty"}). Read the original before deciding.
            </p>
          ) : null}
        </div>

        <aside aria-label="Score" className="space-y-6 lg:sticky lg:top-24 lg:self-start">
          <div className="flex items-center gap-5 rounded-xl border bg-card p-5">
            <ScoreRing score={job.jobFitScore} decision={job.decision} size={92} stroke={8} />
            <div>
              <p className="text-sm text-muted-foreground">Match score</p>
              <p className="tabular text-sm">Evidence coverage {job.scoringCoverage ?? "–"}%</p>
              <p className="tabular text-sm">Keyword score {job.atsScore ?? "–"}</p>
            </div>
          </div>

          <div className="rounded-xl border bg-card p-5">
            <h2 className="text-sm font-semibold text-muted-foreground">How the score is built</h2>
            <BreakdownRadar breakdown={job.breakdown} />
            <ul className="mt-2 space-y-1.5 text-sm">
              {BREAKDOWN_KEYS.map((key) => (
                <li key={key} className="flex justify-between gap-3">
                  <span>{BREAKDOWN_LABELS[key]} <span className="text-muted-foreground">({Math.round(BREAKDOWN_WEIGHTS[key] * 100)}%)</span></span>
                  <span className="tabular font-medium">{job.breakdown[key] ?? "no data"}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="rounded-xl border bg-card p-5">
            <h2 className="text-sm font-semibold text-muted-foreground">Gates</h2>
            <ul className="mt-3 space-y-3">
              {GATE_KEYS.map((key) => (
                <li key={key} className="flex items-start gap-3 text-sm">
                  <span className="mt-0.5"><FitGlyph status={job.gates[key].status} /></span>
                  <span>
                    <span className="font-medium">{GATE_LABELS[key]}</span>
                    <span className="block text-pretty text-muted-foreground">{job.gates[key].note}</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </aside>
      </div>
    </div>
  );
}

export function JobDetail({ stateKey }: { stateKey: string }) {
  const { data: job, isPending, isError, error, refetch } = useJob(stateKey);
  if (isPending) {
    return (
      <div aria-busy="true">
        <Skeleton className="mb-6 h-9 w-2/3" />
        <LoadingRows count={3} label="Loading job" />
      </div>
    );
  }
  if (isError) return <ErrorState message={error instanceof Error ? error.message : "Something went wrong."} onRetry={() => refetch()} />;
  if (!job) {
    return (
      <EmptyState title="This job is not in the current results" action={<Button asChild><Link href="/jobs">Back to all jobs</Link></Button>}>
        It may have come from an older run. Open the jobs list to see what is available now.
      </EmptyState>
    );
  }
  return <Detail job={job} />;
}

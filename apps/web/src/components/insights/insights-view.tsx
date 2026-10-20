"use client";

import { DecisionDonut } from "@/components/charts/decision-donut";
import { FunnelChart } from "@/components/charts/funnel-chart";
import { ScoreHistogram } from "@/components/charts/score-histogram";
import { SkillDemandChart } from "@/components/charts/skill-demand-chart";
import { ErrorState, LoadingRows } from "@/components/shared/state-views";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useInsights, useJobs } from "@/lib/query/hooks";
import type { Decision, SkillGap } from "@/lib/schema";
import { cn } from "@/lib/utils";

const PRIORITY_STYLE: Record<SkillGap["priority"], string> = {
  HIGH: "bg-gap-soft text-gap border-gap/30",
  MEDIUM: "bg-partial-soft text-partial border-partial/30",
  LOW: "bg-muted text-muted-foreground",
  "—": ""
};
const STAGE_LABEL = { filter: "Title filter", "pre-ranker": "Pre-ranking", enrichment: "Full-description check", analysis: "Analysis" } as const;

function Block({ title, intro, children, className }: { title: string; intro?: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={cn("rounded-xl border bg-card p-5 sm:p-6", className)} aria-label={title}>
      <h2 className="text-lg font-semibold">{title}</h2>
      {intro ? <p className="mt-1 max-w-prose text-pretty text-sm text-muted-foreground">{intro}</p> : null}
      <div className="mt-5">{children}</div>
    </section>
  );
}

export function InsightsView() {
  const insights = useInsights();
  const jobs = useJobs();

  if (insights.isError || jobs.isError) {
    const err = insights.error ?? jobs.error;
    return <ErrorState message={err instanceof Error ? err.message : "Something went wrong."} onRetry={() => { insights.refetch(); jobs.refetch(); }} />;
  }
  if (insights.isPending || jobs.isPending) {
    return (
      <div aria-busy="true" className="space-y-6">
        <Skeleton className="h-24 w-full" />
        <LoadingRows count={3} label="Loading insights" />
      </div>
    );
  }

  const { funnel, skillGaps } = insights.data;
  const counts = jobs.data.reduce<Record<Decision, number>>((acc, job) => ({ ...acc, [job.decision]: acc[job.decision] + 1 }), { APPLY: 0, MAYBE: 0, SKIP: 0 });
  const scores = jobs.data.flatMap((job) => (job.jobFitScore === null ? [] : [job.jobFitScore]));
  const gaps = skillGaps.filter((skill) => skill.level !== "Strong" && skill.priority !== "—");
  const byStage = Object.entries(
    funnel.exclusions.reduce<Record<string, typeof funnel.exclusions>>((acc, item) => ({ ...acc, [item.stage]: [...(acc[item.stage] ?? []), item] }), {})
  );

  return (
    <div className="space-y-6">
      <dl className="grid grid-cols-2 gap-y-6 border-y py-6 sm:grid-cols-4">
        {[
          ["Discovered", funnel.discovered],
          ["Read and scored", funnel.analysed],
          ["Reused from earlier runs", funnel.cachedReused],
          ["Newly analysed", funnel.newlyAnalysed]
        ].map(([label, value]) => (
          <div key={label as string} className="sm:border-l sm:pl-6 first:sm:border-l-0 first:sm:pl-0">
            <dt className="text-sm text-muted-foreground">{label}</dt>
            <dd className="tabular mt-1 text-4xl font-semibold">{value}</dd>
          </div>
        ))}
      </dl>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1.4fr_1fr]">
        <Block title="From discovered to scored" intro="Each step is a rule you can inspect. Jobs that stop early are listed with their reason below.">
          <FunnelChart funnel={funnel} />
        </Block>
        <Block title="Recommendations" intro="Apply needs a score of 75 or more and every gate confirmed.">
          <DecisionDonut counts={counts} />
        </Block>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_1.2fr]">
        <Block title="Score distribution" intro="Green starts at 75, amber at 60.">
          <ScoreHistogram scores={scores} />
        </Block>
        <Block title="Skills the jobs ask for" intro="How many scored jobs request each skill, coloured by what your CV shows.">
          <SkillDemandChart skills={skillGaps} />
        </Block>
      </div>

      <Block title="Skills worth building" intro="Ranked by how many jobs ask for the skill and how often as a hard requirement. Based on these twelve jobs only, so treat it as a hint, not a verdict.">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[34rem] text-left text-sm">
            <thead className="text-muted-foreground">
              <tr className="border-b">
                <th scope="col" className="py-2 pr-4 font-medium">Skill</th>
                <th scope="col" className="py-2 pr-4 font-medium">Jobs</th>
                <th scope="col" className="py-2 pr-4 font-medium">Required</th>
                <th scope="col" className="py-2 pr-4 font-medium">In your CV</th>
                <th scope="col" className="py-2 font-medium">Priority</th>
              </tr>
            </thead>
            <tbody>
              {gaps.map((skill) => (
                <tr key={skill.id} className="border-b last:border-0 align-top">
                  <th scope="row" className="py-3 pr-4 font-medium">
                    {skill.skill}
                    {skill.note ? <span className="mt-0.5 block text-xs font-normal text-muted-foreground">{skill.note}</span> : null}
                  </th>
                  <td className="tabular py-3 pr-4">{skill.count} <span className="text-muted-foreground">({skill.percent}%)</span></td>
                  <td className="tabular py-3 pr-4">{skill.required}</td>
                  <td className="py-3 pr-4">{skill.level === "Partial" ? "Related only" : "No evidence"}</td>
                  <td className="py-3"><Badge variant="outline" className={cn("rounded-full", PRIORITY_STYLE[skill.priority])}>{skill.priority.toLowerCase()}</Badge></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Block>

      <Block title="Why jobs were left out" intro="Recorded for every discovered job, so a wrong exclusion can be found and fixed.">
        <div className="grid grid-cols-1 gap-8 md:grid-cols-2">
          {byStage.map(([stage, items]) => (
            <div key={stage}>
              <h3 className="text-sm font-semibold text-muted-foreground">{STAGE_LABEL[stage as keyof typeof STAGE_LABEL]}</h3>
              <ul className="mt-2 divide-y divide-border">
                {items.map((item) => (
                  <li key={item.reason} className="flex items-baseline justify-between gap-4 py-2.5 text-sm">
                    <span className="text-pretty">{item.reason}</span>
                    <span className="tabular font-medium">{item.count}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </Block>
    </div>
  );
}

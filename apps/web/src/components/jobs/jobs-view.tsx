"use client";

import { RotateCcw } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { EmptyState, ErrorState, LoadingRows } from "@/components/shared/state-views";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { workMode } from "@/lib/job-helpers";
import { useJobs } from "@/lib/query/hooks";
import type { Decision } from "@/lib/schema";
import { JobRow } from "./job-row";

type DecisionFilter = "ALL" | Decision;
type SortKey = "score" | "newest";

export function JobsView() {
  const { data: jobs, isPending, isError, error, refetch } = useJobs();
  const [query, setQuery] = useState("");
  const [decision, setDecision] = useState<DecisionFilter>("ALL");
  const [mode, setMode] = useState("all");
  const [source, setSource] = useState("all");
  const [minScore, setMinScore] = useState(0);
  const [sort, setSort] = useState<SortKey>("score");

  const counts = useMemo(() => {
    const base = { ALL: jobs?.length ?? 0, APPLY: 0, MAYBE: 0, SKIP: 0 };
    for (const job of jobs ?? []) base[job.decision] += 1;
    return base;
  }, [jobs]);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return (jobs ?? [])
      .filter((job) => decision === "ALL" || job.decision === decision)
      .filter((job) => mode === "all" || workMode(job).toLowerCase() === mode)
      .filter((job) => source === "all" || job.sourceInfo.source === source)
      .filter((job) => (job.jobFitScore ?? 0) >= minScore)
      .filter((job) => !needle || `${job.title} ${job.company} ${job.sourceInfo.location}`.toLowerCase().includes(needle))
      .sort((a, b) =>
        sort === "score"
          ? (b.jobFitScore ?? -1) - (a.jobFitScore ?? -1)
          : (b.sourceInfo.created ?? "").localeCompare(a.sourceInfo.created ?? "")
      );
  }, [jobs, query, decision, mode, source, minScore, sort]);

  const filtered = query !== "" || decision !== "ALL" || mode !== "all" || source !== "all" || minScore > 0;
  const reset = () => {
    setQuery("");
    setDecision("ALL");
    setMode("all");
    setSource("all");
    setMinScore(0);
  };

  if (isError) return <ErrorState message={error instanceof Error ? error.message : "Something went wrong."} onRetry={() => refetch()} />;

  return (
    <div className="grid grid-cols-1 gap-8 lg:grid-cols-[17rem_1fr]">
      <aside aria-label="Filters" className="space-y-6 lg:sticky lg:top-24 lg:self-start">
        <div className="space-y-2">
          <Label htmlFor="job-search">Search</Label>
          <Input id="job-search" type="search" placeholder="Title, company or place" value={query} onChange={(event) => setQuery(event.target.value)} />
        </div>

        <div className="space-y-2">
          <Label id="decision-label">Recommendation</Label>
          <ToggleGroup
            type="single"
            variant="outline"
            value={decision}
            onValueChange={(value) => setDecision((value || "ALL") as DecisionFilter)}
            aria-labelledby="decision-label"
            className="w-full flex-wrap justify-start"
          >
            {(["ALL", "APPLY", "MAYBE", "SKIP"] as const).map((key) => (
              <ToggleGroupItem key={key} value={key} className="tabular px-3 text-xs">
                {key === "ALL" ? "All" : key === "APPLY" ? "Apply" : key === "MAYBE" ? "Review" : "Skip"} {counts[key]}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>

        <div className="space-y-2">
          <Label htmlFor="mode">Work mode</Label>
          <Select value={mode} onValueChange={setMode}>
            <SelectTrigger id="mode" className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Any</SelectItem>
              <SelectItem value="remote">Remote</SelectItem>
              <SelectItem value="hybrid">Hybrid</SelectItem>
              <SelectItem value="onsite">Onsite</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label htmlFor="source">Source</Label>
          <Select value={source} onValueChange={setSource}>
            <SelectTrigger id="source" className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All sources</SelectItem>
              <SelectItem value="adzuna">Adzuna</SelectItem>
              <SelectItem value="himalayas">Himalayas</SelectItem>
              <SelectItem value="freehire">FreeHire</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-3">
          <div className="flex items-baseline justify-between">
            <Label htmlFor="min-score">Minimum match</Label>
            <span className="tabular text-sm text-muted-foreground">{minScore}</span>
          </div>
          <Slider id="min-score" min={0} max={90} step={5} value={[minScore]} onValueChange={([value]) => setMinScore(value)} aria-label="Minimum match score" />
        </div>

        {filtered ? (
          <Button variant="ghost" size="sm" onClick={reset}>
            <RotateCcw className="size-3.5" aria-hidden /> Clear filters
          </Button>
        ) : null}
      </aside>

      <section aria-label="Jobs" aria-busy={isPending}>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground" aria-live="polite">
            {isPending ? "Loading jobs…" : `${visible.length} of ${jobs?.length ?? 0} jobs`}
          </p>
          <div className="flex items-center gap-2">
            <Label htmlFor="sort" className="text-sm text-muted-foreground">Sort by</Label>
            <Select value={sort} onValueChange={(value) => setSort(value as SortKey)}>
              <SelectTrigger id="sort" className="w-40"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="score">Match score</SelectItem>
                <SelectItem value="newest">Newest first</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {isPending ? (
          <LoadingRows label="Loading jobs" />
        ) : visible.length === 0 ? (
          filtered ? (
            <EmptyState title="No jobs match these filters" action={<Button onClick={reset}>Clear filters</Button>}>
              Loosen the minimum match or pick a different work mode to see more.
            </EmptyState>
          ) : (
            <EmptyState title="No jobs yet" action={<Button asChild><Link href="/onboarding">Set up your search</Link></Button>}>
              Upload your CV and choose what you are looking for. Scored jobs will appear here with the reasons for each score.
            </EmptyState>
          )
        ) : (
          <div className="divide-y divide-border overflow-hidden rounded-xl border bg-card">
            {visible.map((job) => (
              <JobRow key={job.stateKey} job={job} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

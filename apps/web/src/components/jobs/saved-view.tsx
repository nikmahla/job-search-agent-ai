"use client";

import Link from "next/link";
import { EmptyState, ErrorState, LoadingRows } from "@/components/shared/state-views";
import { Button } from "@/components/ui/button";
import { useJobs } from "@/lib/query/hooks";
import { useSavedJobs } from "@/lib/store";
import { JobRow } from "./job-row";

export function SavedView() {
  const { data: jobs, isPending, isError, error, refetch } = useJobs();
  const { saved } = useSavedJobs();

  if (isError) return <ErrorState message={error instanceof Error ? error.message : "Something went wrong."} onRetry={() => refetch()} />;
  if (isPending) return <LoadingRows count={3} label="Loading saved jobs" />;

  const rows = (jobs ?? []).filter((job) => saved.includes(job.stateKey));
  if (!rows.length) {
    return (
      <EmptyState title="Nothing saved yet" action={<Button asChild><Link href="/jobs">Browse jobs</Link></Button>}>
        Use the bookmark on any job to keep it here while you compare.
      </EmptyState>
    );
  }
  return (
    <div className="divide-y divide-border overflow-hidden rounded-xl border bg-card">
      {rows.map((job) => (
        <JobRow key={job.stateKey} job={job} />
      ))}
    </div>
  );
}

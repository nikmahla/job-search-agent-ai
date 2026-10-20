import type { Metadata } from "next";
import { JobsView } from "@/components/jobs/jobs-view";

export const metadata: Metadata = { title: "Jobs" };

export default function JobsPage() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
      <header className="mb-8 max-w-2xl">
        <h1 className="text-3xl font-semibold sm:text-4xl">Scored jobs</h1>
        <p className="mt-3 text-pretty text-muted-foreground">
          Each score comes from checking the posting against your profile. Open a job to see which requirements your CV
          covers and which it does not.
        </p>
      </header>
      <JobsView />
    </div>
  );
}

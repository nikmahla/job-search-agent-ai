import type { Metadata } from "next";
import { JobDetail } from "@/components/jobs/job-detail";

export const metadata: Metadata = { title: "Job detail" };

export default async function JobDetailPage({ params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      <JobDetail stateKey={decodeURIComponent(key)} />
    </div>
  );
}

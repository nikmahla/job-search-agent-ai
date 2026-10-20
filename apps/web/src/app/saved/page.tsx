import type { Metadata } from "next";
import { SavedView } from "@/components/jobs/saved-view";

export const metadata: Metadata = { title: "Saved jobs" };

export default function SavedPage() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
      <header className="mb-8 max-w-2xl">
        <h1 className="text-3xl font-semibold sm:text-4xl">Saved jobs</h1>
        <p className="mt-3 text-pretty text-muted-foreground">Jobs you bookmarked. They are stored in this browser only.</p>
      </header>
      <SavedView />
    </div>
  );
}

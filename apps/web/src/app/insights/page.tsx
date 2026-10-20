import type { Metadata } from "next";
import { InsightsView } from "@/components/insights/insights-view";

export const metadata: Metadata = { title: "Insights" };

export default function InsightsPage() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
      <header className="mb-8 max-w-2xl">
        <h1 className="text-3xl font-semibold sm:text-4xl">What the last run found</h1>
        <p className="mt-3 text-pretty text-muted-foreground">
          How many jobs made it through each step, what the market asks for, and where your CV has gaps.
        </p>
      </header>
      <InsightsView />
    </div>
  );
}

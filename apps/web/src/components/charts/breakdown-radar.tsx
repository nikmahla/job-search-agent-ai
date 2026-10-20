"use client";

import { PolarAngleAxis, PolarGrid, Radar, RadarChart, ResponsiveContainer } from "recharts";
import { BREAKDOWN_KEYS, BREAKDOWN_LABELS, type Breakdown } from "@/lib/schema";

const SHORT: Record<string, string> = {
  technical: "Technical",
  experience: "Experience",
  responsibilities: "Duties",
  qualifications: "Qualifications",
  career: "Direction"
};

export function BreakdownRadar({ breakdown }: { breakdown: Breakdown }) {
  const data = BREAKDOWN_KEYS.map((key) => ({ axis: SHORT[key], value: breakdown[key] ?? 0, label: BREAKDOWN_LABELS[key] }));
  const summary = BREAKDOWN_KEYS.map((key) => `${BREAKDOWN_LABELS[key]} ${breakdown[key] ?? "no data"}`).join(", ");
  return (
    <div className="h-56 w-full" role="img" aria-label={`Score breakdown: ${summary}`}>
      <ResponsiveContainer width="100%" height="100%">
        <RadarChart data={data} outerRadius="62%" margin={{ top: 8, right: 40, bottom: 8, left: 40 }}>
          <PolarGrid stroke="var(--border)" />
          <PolarAngleAxis dataKey="axis" tick={{ fill: "var(--muted-foreground)", fontSize: 12 }} />
          <Radar dataKey="value" stroke="var(--brand)" fill="var(--brand)" fillOpacity={0.22} strokeWidth={2} isAnimationActive={false} />
        </RadarChart>
      </ResponsiveContainer>
    </div>
  );
}

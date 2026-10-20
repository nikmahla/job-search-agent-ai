"use client";

import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

export function ScoreHistogram({ scores }: { scores: number[] }) {
  const bins = Array.from({ length: 10 }, (_, index) => ({ range: `${index * 10}`, from: index * 10, count: 0 }));
  for (const score of scores) bins[Math.min(9, Math.floor(score / 10))].count += 1;
  const summary = bins.filter((bin) => bin.count).map((bin) => `${bin.from} to ${bin.from + 9}: ${bin.count}`).join(", ");
  return (
    <div className="h-52 w-full" role="img" aria-label={`Score distribution. ${summary}`}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={bins} margin={{ left: -20, right: 8, top: 8 }}>
          <CartesianGrid vertical={false} stroke="var(--border)" />
          <XAxis dataKey="range" tickLine={false} axisLine={false} tick={{ fill: "var(--muted-foreground)", fontSize: 12 }} />
          <YAxis allowDecimals={false} tickLine={false} axisLine={false} tick={{ fill: "var(--muted-foreground)", fontSize: 12 }} />
          <Tooltip
            cursor={{ fill: "var(--accent)" }}
            contentStyle={{ background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 8, color: "var(--foreground)" }}
            formatter={(value) => [`${value} jobs`, "Count"]}
            labelFormatter={(label) => `Score ${label}–${Number(label) + 9}`}
          />
          <Bar dataKey="count" radius={[4, 4, 0, 0]} isAnimationActive={false}>
            {bins.map((bin) => (
              <Cell key={bin.range} fill={bin.from >= 75 ? "var(--chart-1)" : bin.from >= 60 ? "var(--chart-2)" : "var(--chart-3)"} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

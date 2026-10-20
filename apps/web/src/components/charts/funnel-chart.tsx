"use client";

import { Bar, BarChart, Cell, LabelList, ResponsiveContainer, XAxis, YAxis } from "recharts";
import type { Funnel } from "@/lib/schema";

export function FunnelChart({ funnel }: { funnel: Funnel }) {
  const data = [
    { step: "Discovered", value: funnel.discovered, fill: "var(--chart-5)" },
    { step: "Passed filter", value: funnel.passedFilter, fill: "var(--chart-4)" },
    { step: "Eligible", value: funnel.eligible, fill: "var(--chart-4)" },
    { step: "Read and scored", value: funnel.analysed, fill: "var(--chart-1)" }
  ];
  const summary = data.map((item) => `${item.step} ${item.value}`).join(", ");
  return (
    <div className="h-64 w-full" role="img" aria-label={`Funnel: ${summary}`}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout="vertical" margin={{ left: 8, right: 40, top: 4, bottom: 4 }}>
          <XAxis type="number" hide domain={[0, funnel.discovered]} />
          <YAxis type="category" dataKey="step" width={110} tickLine={false} axisLine={false} tick={{ fill: "var(--foreground)", fontSize: 13 }} />
          <Bar dataKey="value" radius={[0, 6, 6, 0]} barSize={26} isAnimationActive={false}>
            {data.map((item) => (
              <Cell key={item.step} fill={item.fill} />
            ))}
            <LabelList dataKey="value" position="right" fill="var(--foreground)" fontSize={13} />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

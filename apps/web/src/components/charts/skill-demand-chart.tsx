"use client";

import { Bar, BarChart, Cell, LabelList, ResponsiveContainer, XAxis, YAxis } from "recharts";
import type { SkillGap } from "@/lib/schema";

const FILL = { Strong: "var(--chart-1)", Partial: "var(--chart-2)", Missing: "var(--chart-3)" } as const;

export function SkillDemandChart({ skills }: { skills: SkillGap[] }) {
  const data = skills.slice(0, 10).map((skill) => ({ name: skill.skill, count: skill.count, level: skill.level }));
  const summary = data.map((item) => `${item.name} ${item.count} jobs, ${item.level}`).join("; ");
  return (
    <div>
      <div className="h-80 w-full" role="img" aria-label={`Most requested skills. ${summary}`}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} layout="vertical" margin={{ left: 4, right: 32 }}>
            <XAxis type="number" hide />
            <YAxis type="category" dataKey="name" width={96} tickLine={false} axisLine={false} tick={{ fill: "var(--foreground)", fontSize: 13 }} />
            <Bar dataKey="count" barSize={18} radius={[0, 5, 5, 0]} isAnimationActive={false}>
              {data.map((item) => (
                <Cell key={item.name} fill={FILL[item.level]} />
              ))}
              <LabelList dataKey="count" position="right" fill="var(--foreground)" fontSize={12} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-sm">
        {(["Strong", "Partial", "Missing"] as const).map((level) => (
          <li key={level} className="flex items-center gap-2">
            <span className="size-3 rounded-sm" style={{ background: FILL[level] }} aria-hidden />
            {level === "Strong" ? "In your CV" : level === "Partial" ? "Related only" : "Not in your CV"}
          </li>
        ))}
      </ul>
    </div>
  );
}

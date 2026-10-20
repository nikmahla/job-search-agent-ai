"use client";

import { Cell, Pie, PieChart, ResponsiveContainer } from "recharts";
import { decisionLabel } from "@/components/shared/decision-badge";
import type { Decision } from "@/lib/schema";

const FILL: Record<Decision, string> = { APPLY: "var(--chart-1)", MAYBE: "var(--chart-2)", SKIP: "var(--chart-3)" };

export function DecisionDonut({ counts }: { counts: Record<Decision, number> }) {
  const order: Decision[] = ["APPLY", "MAYBE", "SKIP"];
  const total = order.reduce((sum, key) => sum + counts[key], 0);
  const data = order.map((key) => ({ key, value: counts[key] })).filter((item) => item.value > 0);
  return (
    <div className="flex flex-col items-center gap-5 sm:flex-row">
      <div className="relative size-44 shrink-0" role="img" aria-label={order.map((key) => `${decisionLabel(key)} ${counts[key]}`).join(", ")}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={data} dataKey="value" innerRadius="64%" outerRadius="100%" paddingAngle={2} stroke="none" isAnimationActive={false}>
              {data.map((item) => (
                <Cell key={item.key} fill={FILL[item.key]} />
              ))}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 grid place-items-center text-center">
          <div>
            <p className="tabular text-3xl font-semibold">{total}</p>
            <p className="text-xs text-muted-foreground">jobs scored</p>
          </div>
        </div>
      </div>
      <ul className="space-y-2 text-sm">
        {order.map((key) => (
          <li key={key} className="flex items-center gap-2.5">
            <span className="size-3 rounded-sm" style={{ background: FILL[key] }} aria-hidden />
            <span className="w-14 font-medium">{decisionLabel(key)}</span>
            <span className="tabular text-muted-foreground">{counts[key]}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

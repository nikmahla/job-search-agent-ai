"use client";

import { motion, useReducedMotion } from "framer-motion";
import type { Decision } from "@/lib/schema";

const COLOR: Record<Decision, string> = { APPLY: "var(--match)", MAYBE: "var(--partial)", SKIP: "var(--gap)" };

export function ScoreRing({
  score,
  decision,
  size = 64,
  stroke = 6,
  animate = true
}: {
  score: number | null;
  decision: Decision;
  size?: number;
  stroke?: number;
  animate?: boolean;
}) {
  const reduce = useReducedMotion();
  const r = (size - stroke) / 2;
  const circumference = 2 * Math.PI * r;
  const fraction = score === null ? 0 : Math.max(0, Math.min(100, score)) / 100;
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }} role="img" aria-label={score === null ? "No score" : `Match score ${score.toFixed(0)} out of 100`}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--border)" strokeWidth={stroke} />
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={COLOR[decision]}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          initial={{ strokeDashoffset: animate && !reduce ? circumference : circumference * (1 - fraction) }}
          animate={{ strokeDashoffset: circumference * (1 - fraction) }}
          transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
        />
      </svg>
      <span className="tabular absolute inset-0 grid place-items-center font-semibold" style={{ fontSize: size * 0.3 }}>
        {score === null ? "–" : score.toFixed(0)}
      </span>
    </div>
  );
}

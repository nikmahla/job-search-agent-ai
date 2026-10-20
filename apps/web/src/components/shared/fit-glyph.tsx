import type { CoverageStatus, GateStatus } from "@/lib/schema";

export type GlyphStatus = CoverageStatus | GateStatus;

const TONE: Record<GlyphStatus, { color: string; label: string }> = {
  MATCH: { color: "var(--match)", label: "Match" },
  PASS: { color: "var(--match)", label: "Pass" },
  PARTIAL: { color: "var(--partial)", label: "Partial" },
  FLAG: { color: "var(--partial)", label: "Needs review" },
  GAP: { color: "var(--gap)", label: "Gap" },
  FAIL: { color: "var(--gap)", label: "Fail" },
  UNKNOWN: { color: "var(--unknown)", label: "Unknown" }
};

export const glyphLabel = (status: GlyphStatus) => TONE[status].label;
export const glyphColor = (status: GlyphStatus) => TONE[status].color;

/**
 * The product's one visual idea: filled = supported by evidence, half = partly,
 * ring = not in the profile, dashed ring = cannot be judged automatically.
 * Shape carries the meaning as well as colour, so it works without colour vision.
 */
export function FitGlyph({ status, size = 14, title = false }: { status: GlyphStatus; size?: number; title?: boolean }) {
  const { color, label } = TONE[status];
  const r = size / 2 - 1.25;
  const c = size / 2;
  const kind = status === "MATCH" || status === "PASS" ? "full" : status === "PARTIAL" || status === "FLAG" ? "half" : status === "UNKNOWN" ? "dashed" : "ring";
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={label} className="shrink-0">
      {title ? <title>{label}</title> : null}
      {kind === "full" && <circle cx={c} cy={c} r={r + 0.6} fill={color} />}
      {kind === "half" && (
        <>
          <circle cx={c} cy={c} r={r} fill="none" stroke={color} strokeWidth={1.6} />
          <path d={`M ${c} ${c - r} A ${r} ${r} 0 0 1 ${c} ${c + r} Z`} fill={color} />
        </>
      )}
      {kind === "ring" && <circle cx={c} cy={c} r={r} fill="none" stroke={color} strokeWidth={1.8} />}
      {kind === "dashed" && <circle cx={c} cy={c} r={r} fill="none" stroke={color} strokeWidth={1.6} strokeDasharray="2.2 2.2" />}
    </svg>
  );
}

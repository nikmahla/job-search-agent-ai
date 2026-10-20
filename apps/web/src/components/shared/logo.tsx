import Link from "next/link";
import { FitGlyph } from "./fit-glyph";

export function Logo({ className }: { className?: string }) {
  return (
    <Link href="/" className={`inline-flex items-center gap-2 font-semibold tracking-tight ${className ?? ""}`} aria-label="Shortlist home">
      <span className="flex items-center gap-0.5" aria-hidden>
        <FitGlyph status="MATCH" size={11} />
        <FitGlyph status="PARTIAL" size={11} />
        <FitGlyph status="GAP" size={11} />
      </span>
      <span className="text-lg">Shortlist</span>
    </Link>
  );
}

import { Badge } from "@/components/ui/badge";
import type { Decision } from "@/lib/schema";
import { cn } from "@/lib/utils";

const STYLE: Record<Decision, string> = {
  APPLY: "bg-match-soft text-match border-match/30",
  MAYBE: "bg-partial-soft text-partial border-partial/30",
  SKIP: "bg-gap-soft text-gap border-gap/30"
};
const LABEL: Record<Decision, string> = { APPLY: "Apply", MAYBE: "Review", SKIP: "Skip" };

export const decisionLabel = (decision: Decision) => LABEL[decision];

export function DecisionBadge({ decision, className }: { decision: Decision; className?: string }) {
  return (
    <Badge variant="outline" className={cn("rounded-full px-2.5 font-medium", STYLE[decision], className)}>
      {LABEL[decision]}
    </Badge>
  );
}

"use client";

import { Bookmark } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useSavedJobs } from "@/lib/store";
import { cn } from "@/lib/utils";

export function SaveButton({ stateKey, title, withLabel = false, className }: { stateKey: string; title: string; withLabel?: boolean; className?: string }) {
  const { isSaved, toggle } = useSavedJobs();
  const saved = isSaved(stateKey);
  return (
    <Button
      type="button"
      variant={withLabel ? "outline" : "ghost"}
      size={withLabel ? "default" : "icon"}
      aria-pressed={saved}
      aria-label={saved ? `Remove ${title} from saved jobs` : `Save ${title}`}
      onClick={() => toggle(stateKey)}
      className={cn("relative z-10", className)}
    >
      <Bookmark className={cn("size-4", saved && "fill-brand text-brand")} aria-hidden />
      {withLabel ? (saved ? "Saved" : "Save job") : null}
    </Button>
  );
}

import { AlertTriangle, SearchX } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

export function LoadingRows({ count = 5, label = "Loading" }: { count?: number; label?: string }) {
  return (
    <div role="status" aria-live="polite" aria-label={label} className="divide-y divide-border rounded-xl border bg-card">
      {Array.from({ length: count }, (_, index) => (
        <div key={index} className="flex items-center gap-4 p-4 sm:p-5">
          <Skeleton className="size-16 rounded-full" />
          <div className="flex-1 space-y-2.5">
            <Skeleton className="h-4 w-2/5" />
            <Skeleton className="h-3.5 w-1/4" />
            <Skeleton className="h-3.5 w-3/5" />
          </div>
        </div>
      ))}
      <span className="sr-only">{label}…</span>
    </div>
  );
}

export function EmptyState({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <div className="grid place-items-center rounded-xl border border-dashed bg-card/50 px-6 py-16 text-center">
      <SearchX className="mb-4 size-8 text-muted-foreground" aria-hidden />
      <h2 className="text-xl font-semibold">{title}</h2>
      <p className="mt-2 max-w-md text-pretty text-muted-foreground">{children}</p>
      {action ? <div className="mt-6">{action}</div> : null}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="grid place-items-center rounded-xl border border-gap/30 bg-gap-soft px-6 py-14 text-center">
      <AlertTriangle className="mb-4 size-8 text-gap" aria-hidden />
      <h2 className="text-xl font-semibold">Could not load this page</h2>
      <p className="mt-2 max-w-md text-pretty text-foreground/80">{message}</p>
      {onRetry ? (
        <Button className="mt-6" onClick={onRetry}>
          Try again
        </Button>
      ) : null}
    </div>
  );
}

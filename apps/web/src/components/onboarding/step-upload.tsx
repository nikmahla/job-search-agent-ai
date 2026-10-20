"use client";

import { FileText, UploadCloud } from "lucide-react";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const ACCEPT = ".pdf,.doc,.docx,.txt";

export function StepUpload({ onFile, onSample, busy }: { onFile: (file: File) => void; onSample: () => void; busy: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  return (
    <div className="space-y-5">
      <div
        onDragOver={(event) => { event.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={(event) => {
          event.preventDefault();
          setOver(false);
          const file = event.dataTransfer.files[0];
          if (file) onFile(file);
        }}
        className={cn("grid place-items-center rounded-2xl border-2 border-dashed px-6 py-14 text-center transition-colors", over ? "border-brand bg-brand-soft/60" : "border-input bg-card/60")}
      >
        {busy ? (
          <div role="status" aria-live="polite" className="w-full max-w-xs space-y-3">
            <p className="font-medium">Preparing the sample profile…</p>
            {[88, 72, 80, 56].map((width, index) => (
              <div key={index} className="h-3 animate-pulse rounded-full bg-muted" style={{ width: `${width}%`, animationDelay: `${index * 120}ms` }} />
            ))}
          </div>
        ) : (
          <>
            <UploadCloud className="mb-4 size-9 text-muted-foreground" aria-hidden />
            <p className="text-lg font-semibold">Drop your CV here</p>
            <p className="mt-1 text-sm text-muted-foreground">PDF, Word or plain text</p>
            <div className="mt-6 flex flex-wrap justify-center gap-3">
              <Button type="button" onClick={() => input.current?.click()}>Choose a file</Button>
              <Button type="button" variant="outline" onClick={onSample}>
                <FileText className="size-4" aria-hidden /> Use the sample CV
              </Button>
            </div>
            <input ref={input} type="file" accept={ACCEPT} className="sr-only" tabIndex={-1} aria-label="Choose a CV file" onChange={(event) => { const file = event.target.files?.[0]; if (file) onFile(file); }} />
          </>
        )}
      </div>
      <p className="rounded-lg bg-muted px-4 py-3 text-sm text-muted-foreground">
        This is a demo. Your file is not read, uploaded or stored; the next step shows a made-up profile so you can see how the review would work. CV parsing is planned but not built yet: today the agent reads a profile file you write by hand.
      </p>
    </div>
  );
}

"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { ArrowLeft, ArrowRight, Check, Play } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ErrorState } from "@/components/shared/state-views";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { api, type SearchProgress } from "@/lib/api";
import type { CandidateProfile, Preferences } from "@/lib/schema";
import { cn } from "@/lib/utils";
import { StepPreferences } from "./step-preferences";
import { StepProfile } from "./step-profile";
import { StepRun } from "./step-run";
import { StepUpload } from "./step-upload";

const STEPS = [
  { title: "Upload your CV", hint: "Start from the document you already have." },
  { title: "Check your profile", hint: "Review the sample profile and fix anything that is wrong." },
  { title: "Set preferences", hint: "Tell it what to look for and where." },
  { title: "Run the search", hint: "Review the setup, then search." }
] as const;

export function Wizard() {
  const router = useRouter();
  const reduce = useReducedMotion();
  const [step, setStep] = useState(0);
  const [parsing, setParsing] = useState(false);
  const [profile, setProfile] = useState<CandidateProfile | null>(null);
  const [preferences, setPreferences] = useState<Preferences | null>(null);
  const [progress, setProgress] = useState<SearchProgress | null>(null);
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const firstRender = useRef(true);

  // Move focus (and the view) to the new step so keyboard and screen-reader users land on it.
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    heading.current?.focus();
  }, [step]);

  useEffect(() => {
    api.getDefaultPreferences().then(setPreferences, () => setError("Could not load the default preferences."));
  }, []);

  const parse = async (name: string | null) => {
    setParsing(true);
    setError(null);
    try {
      setProfile(await api.parseCv(name));
      setStep(1);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not read the CV.");
    } finally {
      setParsing(false);
    }
  };

  const run = async () => {
    if (!preferences) return;
    setRunning(true);
    setDone(false);
    setError(null);
    setProgress(null);
    try {
      await api.runSearch(preferences, setProgress);
      setDone(true);
      setTimeout(() => router.push("/jobs"), 1200);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The search failed.");
    } finally {
      setRunning(false);
    }
  };

  const canContinue = step === 1 ? profile !== null : step === 2 ? (preferences?.targetRoles.length ?? 0) > 0 : true;
  const percent = done ? 100 : progress?.percent ?? 0;

  return (
    <div className="grid grid-cols-1 gap-10 lg:grid-cols-[16rem_1fr]">
      <nav aria-label="Setup steps">
        <ol className="flex gap-2 overflow-x-auto lg:flex-col lg:gap-1 lg:overflow-visible">
          {STEPS.map((item, index) => {
            const complete = index < step || done;
            const current = index === step;
            return (
              <li key={item.title} className="shrink-0 lg:shrink" aria-current={current ? "step" : undefined}>
                <button
                  type="button"
                  disabled={index > step || running}
                  onClick={() => setStep(index)}
                  className={cn("flex w-full items-start gap-3 rounded-lg px-3 py-3 text-left transition-colors disabled:cursor-default", current ? "bg-accent" : "hover:bg-accent/50 disabled:hover:bg-transparent")}
                >
                  <span className={cn("tabular mt-0.5 grid size-6 shrink-0 place-items-center rounded-full border text-xs font-semibold", complete ? "border-match bg-match text-background" : current ? "border-brand text-brand" : "text-muted-foreground")}>
                    {complete ? <Check className="size-3.5" aria-hidden /> : index + 1}
                  </span>
                  <span>
                    <span className={cn("block text-sm font-medium", !current && !complete && "text-muted-foreground")}>{item.title}</span>
                    <span className="hidden text-xs text-muted-foreground lg:block">{item.hint}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      </nav>

      <section aria-labelledby="step-title" className="min-w-0">
        <h1 id="step-title" ref={heading} tabIndex={-1} className="text-3xl font-semibold outline-none sm:text-4xl">{STEPS[step].title}</h1>
        <p className="mb-8 mt-2 text-muted-foreground">{STEPS[step].hint}</p>

        {error ? <div className="mb-6"><ErrorState message={error} onRetry={() => setError(null)} /></div> : null}

        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={step}
            initial={reduce ? false : { opacity: 0, x: 16 }}
            animate={{ opacity: 1, x: 0 }}
            exit={reduce ? undefined : { opacity: 0, x: -16 }}
            transition={{ duration: 0.2 }}
          >
            {step === 0 && <StepUpload busy={parsing} onFile={(file) => parse(file.name)} onSample={() => parse(null)} />}
            {step === 1 && profile && <StepProfile profile={profile} onChange={setProfile} />}
            {step === 2 && preferences && <StepPreferences value={preferences} onChange={setPreferences} />}
            {step === 3 && preferences && (
              <>
                {running || done ? <Progress value={percent} className="mb-6" aria-label="Search progress" /> : null}
                <StepRun preferences={preferences} progress={progress} running={running} done={done} />
              </>
            )}
          </motion.div>
        </AnimatePresence>

        <div className="mt-10 flex items-center justify-between border-t pt-6">
          <Button variant="ghost" onClick={() => setStep(step - 1)} disabled={step === 0 || running || done}>
            <ArrowLeft className="size-4" aria-hidden /> Back
          </Button>
          {step === 3 ? (
            <Button onClick={run} disabled={running || done || !preferences}>
              <Play className="size-4" aria-hidden /> {done ? "Opening your jobs…" : running ? "Replaying…" : "Run the demo search"}
            </Button>
          ) : step > 0 ? (
            <Button onClick={() => setStep(step + 1)} disabled={!canContinue}>
              Continue <ArrowRight className="size-4" aria-hidden />
            </Button>
          ) : (
            <span />
          )}
        </div>
      </section>
    </div>
  );
}

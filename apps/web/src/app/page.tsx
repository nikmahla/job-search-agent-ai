import { ArrowRight, FileText, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { EvidenceMap } from "@/components/landing/evidence-map";
import { FunnelTeaser } from "@/components/landing/funnel-teaser";
import { ScoreAnatomy } from "@/components/landing/score-anatomy";
import { Button } from "@/components/ui/button";

export default function LandingPage() {
  return (
    <>
      <section className="grid-dots border-b">
        <div className="mx-auto grid grid-cols-1 max-w-6xl items-center gap-12 px-4 py-16 sm:px-6 lg:grid-cols-[1fr_1.05fr] lg:py-24">
          <div>
            <h1 className="text-balance text-4xl font-semibold leading-[1.05] sm:text-6xl">See exactly why a job fits your CV.</h1>
            <p className="mt-6 max-w-xl text-pretty text-lg text-muted-foreground">
              Shortlist reads each posting, checks every requirement against your profile, and shows the evidence line by
              line. A job never gets a score without a reason.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Button asChild size="lg">
                <Link href="/jobs">
                  Browse the demo jobs <ArrowRight className="size-4" aria-hidden />
                </Link>
              </Button>
              <Button asChild size="lg" variant="outline">
                <Link href="/onboarding">
                  <FileText className="size-4" aria-hidden /> Start with your CV
                </Link>
              </Button>
            </div>
            <p className="mt-5 text-sm text-muted-foreground">Demo mode: twelve synthetic jobs and a made-up candidate. CV upload and live search are not built yet; the scores, gates and reasons you see follow the rules of the real agent. Nothing you type leaves your browser.</p>
          </div>
          <EvidenceMap />
        </div>
      </section>

      <section className="border-b">
        <div className="mx-auto grid grid-cols-1 max-w-6xl gap-10 px-4 py-16 sm:px-6 lg:grid-cols-[0.8fr_1.2fr] lg:py-20">
          <div>
            <h2 className="text-3xl font-semibold sm:text-4xl">A score you can take apart.</h2>
            <p className="mt-4 max-w-md text-pretty text-muted-foreground">
              Five weighted parts add up to the match score. Separate gates for role, experience, language, work
              authorization and location decide whether a job can be recommended at all.
            </p>
          </div>
          <ScoreAnatomy />
        </div>
      </section>

      <section className="border-b bg-card/40">
        <div className="mx-auto grid grid-cols-1 max-w-6xl gap-10 px-4 py-16 sm:px-6 lg:grid-cols-[1.2fr_0.8fr] lg:py-20">
          <div className="lg:order-2">
            <h2 className="text-3xl font-semibold sm:text-4xl">Every job that was left out has a reason.</h2>
            <p className="mt-4 max-w-md text-pretty text-muted-foreground">
              Most postings are not for you, and that is fine. The run records where each one stopped and why, so you can
              check that nothing good was dropped by mistake.
            </p>
            <Button asChild variant="link" className="mt-3 px-0">
              <Link href="/insights">
                See the full funnel <ArrowRight className="size-4" aria-hidden />
              </Link>
            </Button>
          </div>
          <div className="lg:order-1">
            <FunnelTeaser />
          </div>
        </div>
      </section>

      <section>
        <div className="mx-auto flex max-w-6xl flex-col items-start gap-6 px-4 py-16 sm:px-6 lg:flex-row lg:items-center lg:justify-between lg:py-20">
          <div className="flex max-w-xl items-start gap-4">
            <ShieldCheck className="mt-1 size-7 shrink-0 text-match" aria-hidden />
            <div>
              <h2 className="text-2xl font-semibold">Your CV stays on your machine.</h2>
              <p className="mt-2 text-pretty text-muted-foreground">
                The agent behind Shortlist runs locally with your own model. In the planned flow a skill is only added to
                your profile when a line in your CV backs it up, and you review the list before anything is searched.
              </p>
            </div>
          </div>
          <Button asChild size="lg">
            <Link href="/onboarding">Try the 4-step setup</Link>
          </Button>
        </div>
      </section>
    </>
  );
}

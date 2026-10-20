import Link from "next/link";
import { Logo } from "@/components/shared/logo";

export function SiteFooter() {
  return (
    <footer className="border-t">
      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-10 sm:flex-row sm:items-start sm:justify-between sm:px-6">
        <div className="max-w-sm">
          <Logo />
          <p className="mt-3 text-sm text-muted-foreground">
            A demo interface for the job-search-agent-ai project. Every job, company and person on these pages is
            synthetic; no CV is read or sent anywhere.
          </p>
        </div>
        <nav aria-label="Footer" className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
          <Link href="/jobs" className="text-muted-foreground hover:text-foreground">Jobs</Link>
          <Link href="/insights" className="text-muted-foreground hover:text-foreground">Insights</Link>
          <Link href="/onboarding" className="text-muted-foreground hover:text-foreground">Start</Link>
          <a href="https://github.com/nikmahla/job-search-agent-ai" className="text-muted-foreground hover:text-foreground" rel="noreferrer">
            Source on GitHub
          </a>
        </nav>
      </div>
    </footer>
  );
}

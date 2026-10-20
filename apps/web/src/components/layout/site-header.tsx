"use client";

import { Menu } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Logo } from "@/components/shared/logo";
import { useSavedJobs } from "@/lib/store";
import { cn } from "@/lib/utils";
import { ThemeToggle } from "./theme-toggle";

const LINKS = [
  { href: "/jobs", label: "Jobs" },
  { href: "/saved", label: "Saved" },
  { href: "/insights", label: "Insights" }
] as const;

export function SiteHeader() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const { saved } = useSavedJobs();

  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`);

  return (
    <header className="sticky top-0 z-40 border-b bg-background/85 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-4 px-4 sm:px-6">
        <Logo />
        <Badge variant="outline" className="hidden rounded-full text-muted-foreground sm:inline-flex">
          Demo data
        </Badge>
        <nav aria-label="Main" className="ml-6 hidden items-center gap-1 md:flex">
          {LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              aria-current={isActive(link.href) ? "page" : undefined}
              className={cn(
                "rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground",
                isActive(link.href) && "bg-accent text-foreground"
              )}
            >
              {link.label}
              {link.href === "/saved" && saved.length > 0 ? (
                <span className="tabular ml-1.5 rounded-full bg-brand-soft px-1.5 py-0.5 text-xs text-brand">{saved.length}</span>
              ) : null}
            </Link>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-1">
          <Button asChild size="sm" className="hidden sm:inline-flex">
            <Link href="/onboarding">Start with your CV</Link>
          </Button>
          <ThemeToggle />
          <Sheet open={open} onOpenChange={setOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="md:hidden" aria-label="Open menu">
                <Menu className="size-5" aria-hidden />
              </Button>
            </SheetTrigger>
            <SheetContent side="right" className="w-72">
              <SheetHeader>
                <SheetTitle>Menu</SheetTitle>
              </SheetHeader>
              <nav aria-label="Mobile" className="flex flex-col gap-1 px-4">
                {[...LINKS, { href: "/onboarding", label: "Start with your CV" }].map((link) => (
                  <Link
                    key={link.href}
                    href={link.href}
                    onClick={() => setOpen(false)}
                    aria-current={isActive(link.href) ? "page" : undefined}
                    className={cn("rounded-md px-3 py-3 text-base font-medium", isActive(link.href) ? "bg-accent" : "hover:bg-accent/60")}
                  >
                    {link.label}
                  </Link>
                ))}
              </nav>
            </SheetContent>
          </Sheet>
        </div>
      </div>
    </header>
  );
}

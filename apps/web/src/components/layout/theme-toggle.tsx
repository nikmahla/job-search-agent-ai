"use client";

import { Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";

export function ThemeToggle() {
  const toggle = () => {
    const dark = !document.documentElement.classList.contains("dark");
    document.documentElement.classList.toggle("dark", dark);
    try {
      localStorage.setItem("shortlist.theme", dark ? "dark" : "light");
    } catch {
      // Theme just will not persist.
    }
  };
  return (
    <Button variant="ghost" size="icon" onClick={toggle} aria-label="Switch between light and dark theme">
      <Sun className="hidden size-4 dark:block" aria-hidden />
      <Moon className="size-4 dark:hidden" aria-hidden />
    </Button>
  );
}

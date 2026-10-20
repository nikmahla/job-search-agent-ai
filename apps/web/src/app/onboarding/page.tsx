import type { Metadata } from "next";
import { Wizard } from "@/components/onboarding/wizard";

export const metadata: Metadata = { title: "Set up your search" };

export default function OnboardingPage() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
      <Wizard />
    </div>
  );
}

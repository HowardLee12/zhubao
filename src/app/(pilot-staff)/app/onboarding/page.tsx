import type { Metadata } from "next";

import { PilotOnboardingForm } from "@/components/pilot/onboarding-form";

export const metadata: Metadata = {
  title: "建立工作空間｜Renoly",
};

export default function PilotOnboardingPage() {
  return <PilotOnboardingForm />;
}

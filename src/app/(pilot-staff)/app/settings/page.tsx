import type { Metadata } from "next";

import { PilotSettings } from "@/components/pilot/settings";

export const metadata: Metadata = {
  title: "店家設定｜Renoly",
};

export default function PilotSettingsPage() {
  return <PilotSettings />;
}

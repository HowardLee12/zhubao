import type { Metadata } from "next";

import { PilotAppEntry } from "@/components/pilot/app-entry";

export const metadata: Metadata = {
  title: "工作台｜Renoly",
};

export default function PilotAppPage() {
  return <PilotAppEntry />;
}

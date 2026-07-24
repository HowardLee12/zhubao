import type { Metadata } from "next";

import { ScheduleBoard } from "@/components/pilot/schedule-board";

export const metadata: Metadata = {
  title: "排程板｜Renoly",
};

export default function PilotSchedulePage() {
  return <ScheduleBoard />;
}

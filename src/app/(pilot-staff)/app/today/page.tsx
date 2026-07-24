import type { Metadata } from "next";

import { TechnicianToday } from "@/components/pilot/technician-today";

export const metadata: Metadata = {
  title: "今日工作｜Renoly",
};

export default function PilotTodayPage() {
  return <TechnicianToday />;
}

import type { Metadata } from "next";

import { KpiDashboard } from "@/components/pilot/kpi-dashboard";

export const metadata: Metadata = {
  title: "營運指標｜Renoly",
};

export default function PilotDashboardPage() {
  return <KpiDashboard />;
}

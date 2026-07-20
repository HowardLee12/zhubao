import type { Metadata } from "next";

import { TeamManagementScreen } from "@/components/pilot/team-management";

export const metadata: Metadata = {
  title: "成員｜Renoly",
};

export default function PilotTeamPage() {
  return <TeamManagementScreen />;
}

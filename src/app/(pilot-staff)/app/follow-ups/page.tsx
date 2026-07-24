import type { Metadata } from "next";

import { FollowUpsView } from "@/components/pilot/follow-ups-view";

export const metadata: Metadata = {
  title: "保養回訪｜Renoly",
};

export default function PilotFollowUpsPage() {
  return <FollowUpsView />;
}

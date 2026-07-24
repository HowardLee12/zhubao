import type { Metadata } from "next";

import { PilotInbox } from "@/components/pilot/inbox";

export const metadata: Metadata = {
  title: "接案匣｜Renoly",
};

export default function PilotInboxPage() {
  return <PilotInbox />;
}

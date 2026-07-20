import type { Metadata } from "next";

import { NotificationsOutbox } from "@/components/pilot/notifications-outbox";

export const metadata: Metadata = {
  title: "通知發送紀錄｜Renoly",
};

export default function PilotNotificationsPage() {
  return <NotificationsOutbox />;
}

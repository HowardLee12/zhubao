import type { Metadata } from "next";

import { TechnicianTaskList } from "@/components/pilot/technician-task-list";

export const metadata: Metadata = {
  title: "我的工單｜Renoly",
};

export default function PilotMyWorkOrdersPage() {
  return <TechnicianTaskList />;
}

import type { Metadata } from "next";

import { TechnicianTaskDetail } from "@/components/pilot/technician-task-detail";

export const metadata: Metadata = {
  title: "現場工單｜Renoly",
};

export default async function PilotTechnicianTaskPage({
  params,
}: Readonly<{ params: Promise<{ id: string }> }>) {
  const { id } = await params;
  return <TechnicianTaskDetail workOrderId={id} />;
}

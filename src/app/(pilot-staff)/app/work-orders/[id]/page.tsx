import type { Metadata } from "next";

import { DispatcherWorkOrderDetail } from "@/components/pilot/work-order-detail";

export const metadata: Metadata = {
  title: "工單工作台｜Renoly",
};

export default async function PilotWorkOrderPage({
  params,
}: Readonly<{ params: Promise<{ id: string }> }>) {
  const { id } = await params;
  return <DispatcherWorkOrderDetail workOrderId={id} />;
}

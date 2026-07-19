import type { Metadata } from "next";

import { PilotRequestDetailLoader } from "@/components/pilot/request-detail-loader";

export const metadata: Metadata = {
  title: "整理進件｜Renoly",
};

export default async function PilotRequestDetailPage({
  params,
}: Readonly<{ params: Promise<{ id: string }> }>) {
  const { id } = await params;
  return <PilotRequestDetailLoader requestId={id} />;
}

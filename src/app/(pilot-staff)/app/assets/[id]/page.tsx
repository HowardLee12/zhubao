import type { Metadata } from "next";

import { AssetHistoryView } from "@/components/pilot/asset-history-view";

export const metadata: Metadata = {
  title: "設備履歷｜Renoly",
};

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function PilotAssetHistoryPage({ params }: PageProps) {
  const { id } = await params;
  return <AssetHistoryView assetId={id} />;
}

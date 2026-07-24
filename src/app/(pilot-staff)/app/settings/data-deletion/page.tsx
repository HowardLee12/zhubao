import type { Metadata } from "next";

import { DataDeletionSettings } from "@/components/pilot/data-deletion-settings";

export const metadata: Metadata = {
  title: "刪除店家資料｜Renoly",
};

export default function PilotDataDeletionPage() {
  return <DataDeletionSettings />;
}

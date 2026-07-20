import type { Metadata } from "next";

import { PilotIntakeDraftReviewLoader } from "@/components/pilot/intake-draft-review-loader";

export const metadata: Metadata = {
  title: "LINE 進件確認｜Renoly",
};

export default async function PilotIntakeDraftReviewPage({
  params,
}: Readonly<{ params: Promise<{ id: string }> }>) {
  const { id } = await params;
  return <PilotIntakeDraftReviewLoader draftId={id} />;
}

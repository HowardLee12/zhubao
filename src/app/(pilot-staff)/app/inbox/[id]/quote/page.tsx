import type { Metadata } from "next";

import { PilotQuoteLoader } from "@/components/pilot/quote-loader";

export const metadata: Metadata = {
  title: "建立報價｜Renoly",
};

export default async function PilotRequestQuotePage({
  params,
}: Readonly<{ params: Promise<{ id: string }> }>) {
  const { id } = await params;
  return <PilotQuoteLoader requestId={id} />;
}

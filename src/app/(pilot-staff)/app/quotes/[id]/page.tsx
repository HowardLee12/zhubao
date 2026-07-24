import type { Metadata } from "next";

import { PilotQuoteLoader } from "@/components/pilot/quote-loader";

export const metadata: Metadata = {
  title: "報價工作區｜Renoly",
};

export default async function PilotQuotePage({
  params,
}: Readonly<{ params: Promise<{ id: string }> }>) {
  const { id } = await params;
  return <PilotQuoteLoader quoteId={id} />;
}

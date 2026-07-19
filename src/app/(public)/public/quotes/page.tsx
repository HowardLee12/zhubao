import type { Metadata } from "next";

import { PilotPublicQuoteFromFragment } from "@/components/pilot/public-quote-fragment";

export const metadata: Metadata = {
  title: "確認報價｜Renoly",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default function PublicQuotePage() {
  return <PilotPublicQuoteFromFragment />;
}

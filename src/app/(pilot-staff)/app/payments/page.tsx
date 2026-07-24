import type { Metadata } from "next";

import { PaymentsView } from "@/components/pilot/payments-view";

export const metadata: Metadata = {
  title: "收款款項｜Renoly",
};

export default function PilotPaymentsPage() {
  return <PaymentsView />;
}

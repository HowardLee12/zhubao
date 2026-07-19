import type { Metadata } from "next";

import { PublicIntakeForm } from "@/components/pilot/public-intake-form";

export const metadata: Metadata = {
  title: "填寫服務需求｜Renoly",
  robots: { index: false, follow: false },
};

export default async function PublicIntakePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  return <PublicIntakeForm token={token} />;
}

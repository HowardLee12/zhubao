import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

export function generateMetadata() {
  return {
    title: "找不到頁面 — Renoly",
    robots: { index: false, follow: false },
  };
}

export default async function QuoteSharePage() {
  notFound();
}

import { notFound } from "next/navigation";
import Link from "next/link";
import { getQuote, getUserProfile } from "@/lib/queries";
import { supabase } from "@/lib/supabase";
import { formatCurrency, calculateClientPrice } from "@/lib/format";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const dynamic = "force-dynamic";

export default async function LinePreviewPage({
  params,
}: Readonly<{ params: Promise<{ id: string }> }>) {
  const { id } = await params;
  if (!UUID_RE.test(id)) notFound();

  const [quote, profile] = await Promise.all([
    getQuote(id),
    getUserProfile(),
  ]);
  if (!quote) notFound();

  const { data: projectData } = await supabase
    .from("projects")
    .select("customer_name, address, description")
    .eq("id", quote.project_id)
    .single();

  const customerName = projectData?.customer_name ?? "屋主";
  const address = projectData?.address ?? "";
  const description = projectData?.description ?? "工程";

  // Pre-compute client totals (cost data never enters the render tree)
  const clientItems = quote.sections.flatMap((s) =>
    s.items.map((it) => ({
      sectionName: s.name,
      name: it.name,
      total:
        calculateClientPrice(it.unit_cost, Number(it.markup_percent)) *
        Number(it.quantity),
    }))
  );
  const clientTotal = clientItems.reduce((sum, it) => sum + it.total, 0);
  const preview = clientItems.slice(0, 3);

  const designerName = profile?.display_name ?? "設計師";
  const todayLabel = (() => {
    const d = new Date();
    return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
  })();

  return (
    <div className="min-h-screen flex flex-col" style={{ background: "#8CABCB" }}>
      {/* LINE-style header (green) */}
      <div
        className="text-white px-3 py-3 flex items-center gap-3 sticky top-0 z-10"
        style={{ background: "#06C755" }}
      >
        <Link
          href={`/quotes/${id}`}
          aria-label="返回報價單"
          className="text-white"
        >
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </Link>
        <div className="flex-1 min-w-0">
          <div className="text-[15px] font-bold truncate">
            {customerName} ({description})
          </div>
          <div className="text-[11px] opacity-85">
            LINE 預覽 · 屋主端看到的樣子
          </div>
        </div>
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M3 5a2 2 0 0 1 2-2h2l2 5-2 1a11 11 0 0 0 5 5l1-2 5 2v2a2 2 0 0 1-2 2A16 16 0 0 1 3 5z" />
        </svg>
      </div>

      {/* Chat body */}
      <div className="flex-1 px-3 pb-32 pt-3 space-y-2">
        {/* Date separator */}
        <div className="text-center text-[10px] text-white/95 my-2">
          {todayLabel}
        </div>

        {/* Designer intro */}
        <div className="bg-white rounded-2xl p-3 max-w-[82%]">
          <div className="text-[12px] text-ink-2 mb-1 font-semibold">
            {designerName}
          </div>
          <div className="text-[14px] leading-relaxed text-ink">
            {customerName}您好，這是 {description} 的報價單，已經把上次討論的調整都加進去了，麻煩您看看 🙏
          </div>
        </div>

        {/* Quote rich card */}
        <div className="bg-white rounded-2xl overflow-hidden max-w-[82%]">
          <div
            className="px-4 pt-3 pb-3 text-white"
            style={{
              background:
                "linear-gradient(135deg, #E2691F 0%, #A04428 100%)",
            }}
          >
            <div className="text-[10px] opacity-80 tracking-wider">
              工程報價單 · v{quote.version}
            </div>
            <div className="text-[15px] font-bold mt-1 leading-snug">
              {customerName} · {description}
            </div>
            <div className="text-[11px] opacity-85 mt-0.5">{address}</div>
            <div className="font-mono text-2xl font-bold mt-2 tracking-tight tabular-nums">
              {formatCurrency(clientTotal)}
            </div>
            <div className="text-[10px] opacity-85">
              含稅 · {quote.sections.length} 個施工分類
            </div>
          </div>
          <div className="px-4 py-2 bg-white">
            {preview.map((it, i) => (
              <div
                key={`${it.sectionName}-${i}`}
                className="flex justify-between text-[11px] py-1 text-ink-2 border-b border-warm-border last:border-b-0"
              >
                <span className="truncate mr-2">
                  {it.sectionName} · {it.name}
                </span>
                <span className="font-mono text-ink shrink-0">
                  {it.total.toLocaleString()}
                </span>
              </div>
            ))}
            {clientItems.length > preview.length && (
              <div className="text-[10px] text-ink-3 text-center py-1">
                還有 {clientItems.length - preview.length} 項…
              </div>
            )}
            <div className="grid grid-cols-2 gap-1.5 mt-2 pt-2 border-t border-warm-border">
              <button
                type="button"
                className="py-2 rounded-lg bg-bg-warm text-ink-2 text-[11px] font-semibold"
              >
                看完整報價
              </button>
              <button
                type="button"
                className="py-2 rounded-lg bg-orange text-white text-[11px] font-semibold"
              >
                接受
              </button>
            </div>
          </div>
        </div>

        {/* Designer follow-up */}
        <div className="bg-white rounded-2xl p-3 max-w-[82%]">
          <div className="text-[13px] leading-relaxed text-ink">
            工期預估 {quote.sections.length * 4} 個工作日，看 OK 我們約週末進場敲牆 💪
          </div>
        </div>

        {/* Owner reply (right side, LINE green-ish) */}
        <div
          className="ml-auto rounded-2xl p-3 max-w-[82%]"
          style={{ background: "#86E26B" }}
        >
          <div className="text-[13px] leading-relaxed text-ink">
            收到～價格 OK，那就麻煩你了
          </div>
          <div className="text-[10px] text-ink-2/55 text-right mt-1 font-mono">
            已讀
          </div>
        </div>

        {/* System info bubble */}
        <div className="text-center text-[10px] my-3">
          <span
            className="inline-block bg-ink/15 text-white px-3 py-1 rounded-full"
          >
            訂金 {formatCurrency(Math.round(clientTotal * 0.3))} 待收款
          </span>
        </div>
      </div>

      {/* Bottom "this is what they see" banner */}
      <div
        className="fixed left-0 right-0 bottom-0 max-w-[430px] mx-auto z-20"
        style={{ background: "#1A1410" }}
      >
        <div className="px-4 py-3 pb-6 flex items-center gap-2.5 text-white">
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="#FCE9D7"
            strokeWidth="1.9"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z" />
            <circle cx="12" cy="12" r="3" />
          </svg>
          <div className="flex-1">
            <div className="text-[12px] font-bold">屋主在 LINE 看到的樣子</div>
            <div className="text-[11px] opacity-60">
              成本與利潤完全不會顯示
            </div>
          </div>
          <Link
            href={`/quotes/${id}`}
            className="bg-orange text-white text-[12px] font-semibold px-3 py-2 rounded-lg"
          >
            回編輯
          </Link>
        </div>
      </div>
    </div>
  );
}

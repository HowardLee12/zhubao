import Link from "next/link";

const STEPS = [
  {
    n: "1",
    title: "建立案件",
    desc: "填屋主、地址，30 秒搞定",
  },
  {
    n: "2",
    title: "用範本做報價",
    desc: "套範本改數字，成本／利潤自動算",
  },
  {
    n: "3",
    title: "LINE 分享給屋主",
    desc: "成本與利潤自動隱藏，只給客戶看",
  },
];

export function OnboardingCard({ canCreate }: Readonly<{ canCreate: boolean }>) {
  return (
    <div className="px-4 mt-2">
      {/* Hero */}
      <div
        className="rounded-2xl p-5 text-white"
        style={{
          background: "linear-gradient(135deg, #E2691F 0%, #A04428 100%)",
        }}
      >
        <div className="text-[13px] opacity-85">歡迎使用 Renoly</div>
        <div className="text-[19px] font-bold mt-1 leading-snug">
          3 步驟，做出第一張
          <br />
          會自動算利潤的報價單
        </div>
      </div>

      {/* Steps */}
      <div className="bg-surface border border-warm-border rounded-2xl mt-3 divide-y divide-warm-border">
        {STEPS.map((s) => (
          <div key={s.n} className="flex items-center gap-3 px-4 py-3.5">
            <div className="w-7 h-7 rounded-full bg-orange-soft text-orange-deep flex items-center justify-center text-[13px] font-bold shrink-0">
              {s.n}
            </div>
            <div className="min-w-0">
              <div className="text-[14px] font-bold text-ink">{s.title}</div>
              <div className="text-[11px] text-ink-3 mt-0.5">{s.desc}</div>
            </div>
          </div>
        ))}
      </div>

      {/* CTA */}
      {canCreate ? (
        <Link
          href="/projects/new"
          className="mt-3 block w-full text-center bg-orange text-white rounded-xl py-3.5 text-sm font-bold active:scale-[0.98] transition-transform"
        >
          建立第一個案件 →
        </Link>
      ) : (
        <Link
          href="/account"
          className="mt-3 block w-full text-center bg-orange-soft text-orange-deep rounded-xl py-3.5 text-sm font-bold"
        >
          案件數已達上限 · 前往升級
        </Link>
      )}

      <div className="text-[11px] text-ink-3 text-center mt-3 mb-6">
        報價單做好可直接 LINE 給屋主，對方看不到你的成本
      </div>
    </div>
  );
}

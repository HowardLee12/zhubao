import type { Metadata } from "next";
import Link from "next/link";

import { V2Icon, type V2IconName } from "@/components/v2/icons";

export const metadata: Metadata = {
  title: "Renoly｜把 LINE 詢問變成不漏單的工程流程",
  description:
    "給 2–10 人冷氣、水電、抓漏、家電維修與小型工程團隊的 LINE-first 接案、報價、派工與完工工作台。",
};

const industries = ["冷氣服務", "水電工程", "抓漏防水", "家電維修", "清潔保養", "小型裝修"];

const workflow: Array<{ step: string; title: string; detail: string; icon: V2IconName }> = [
  { step: "01", title: "集中進件", detail: "LINE、電話與表單需求進同一個接案匣。", icon: "inbox" },
  { step: "02", title: "人工報價", detail: "系統整理草稿，老闆確認價格與範圍才送出。", icon: "quote" },
  { step: "03", title: "排程派工", detail: "把時段、地址、現場重點交到負責技師手上。", icon: "calendar" },
  { step: "04", title: "現場證據", detail: "檢查表、施工前後照與狀態留在同一張工單。", icon: "camera" },
  { step: "05", title: "完工收款", detail: "資料齊全才能完工，後續請款不再翻聊天紀錄。", icon: "check" },
  { step: "06", title: "保養回訪", detail: "設備履歷保留，下次保養有依據也有時機。", icon: "refresh" },
];

function Logo() {
  return (
    <div className="flex items-center gap-3">
      <span className="relative inline-flex h-10 w-10 items-center justify-center overflow-hidden rounded-[14px] bg-ink text-lg font-black text-white shadow-lg shadow-black/10">
        <span className="absolute -right-2 -top-2 h-6 w-6 rounded-full bg-orange" />
        <span className="relative tracking-[-0.08em]">R</span>
      </span>
      <span>
        <span className="block text-base font-black tracking-tight text-ink">Renoly</span>
        <span className="block text-[10px] font-bold tracking-[0.12em] text-ink-3">FIELD WORKSPACE</span>
      </span>
    </div>
  );
}

function DemoLink({ secondary = false }: { secondary?: boolean }) {
  return (
    <Link
      href="/demo"
      className={`inline-flex min-h-12 items-center justify-center gap-2 rounded-xl px-5 text-sm font-black transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange focus-visible:ring-offset-2 ${
        secondary
          ? "border border-warm-border-strong bg-white text-ink hover:border-orange/50"
          : "bg-orange text-white shadow-[0_12px_30px_rgba(226,105,31,0.28)] hover:bg-orange-deep"
      }`}
    >
      操作互動原型
      <V2Icon name="arrow" className="h-4 w-4" />
    </Link>
  );
}

export default function LandingPage() {
  return (
    <div className="relative left-1/2 min-h-dvh w-screen -translate-x-1/2 overflow-hidden bg-[#f8f2e9] text-ink">
      <div className="pointer-events-none absolute inset-0" aria-hidden="true">
        <div className="absolute -right-32 -top-36 h-[30rem] w-[30rem] rounded-full bg-orange/10 blur-3xl" />
        <div className="absolute -left-48 top-[42rem] h-[28rem] w-[28rem] rounded-full bg-brick/8 blur-3xl" />
      </div>

      <header className="relative z-10 border-b border-warm-border/70 bg-[#f8f2e9]/85 backdrop-blur-xl">
        <div className="mx-auto flex min-h-[72px] max-w-6xl items-center justify-between px-5 sm:px-8">
          <Logo />
          <Link
            href="/demo"
            className="inline-flex min-h-11 items-center rounded-xl border border-warm-border bg-white px-4 text-xs font-black text-ink-2 transition hover:border-orange/50 hover:text-orange-deep focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange"
          >
            查看原型
          </Link>
        </div>
      </header>

      <main className="relative">
        <section className="mx-auto grid max-w-6xl gap-10 px-5 pb-16 pt-14 sm:px-8 sm:pt-20 lg:grid-cols-[1.08fr_.92fr] lg:items-center lg:pb-24">
          <div>
            <p className="inline-flex items-center gap-2 rounded-full border border-orange/20 bg-orange-soft/70 px-3 py-1.5 text-xs font-black text-orange-deep">
              <V2Icon name="briefcase" className="h-4 w-4" />
              給 2–10 人現場服務與小型工程團隊
            </p>
            <h1 className="mt-5 max-w-3xl text-[42px] font-black leading-[1.06] tracking-[-0.055em] text-ink sm:text-6xl">
              LINE 裡的詢問，
              <span className="text-orange-deep">變成不漏單的工程流程。</span>
            </h1>
            <p className="mt-6 max-w-2xl text-base leading-8 text-ink-2 sm:text-lg">
              從進件、人工報價、派工到施工證據與完工，不再靠聊天紀錄和腦袋交接。客戶留在 LINE，團隊用手機網頁完成工作。
            </p>
            <div className="mt-7 flex flex-col gap-3 sm:flex-row">
              <DemoLink />
              <a
                href="#workflow"
                className="inline-flex min-h-12 items-center justify-center rounded-xl px-5 text-sm font-black text-ink-2 transition hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange"
              >
                先看完整流程
              </a>
            </div>
            <p className="mt-4 flex items-center gap-2 text-xs font-semibold text-ink-3">
              <V2Icon name="shield" className="h-4 w-4 text-[var(--warm-green)]" />
              AI 只整理草稿；價格、承諾與對客發送一定由人確認。
            </p>
          </div>

          <div className="relative mx-auto w-full max-w-[520px]">
            <div className="absolute -inset-5 rounded-[38px] bg-orange/10 blur-2xl" aria-hidden="true" />
            <div className="relative overflow-hidden rounded-[30px] border border-white/80 bg-white shadow-[0_28px_80px_rgba(74,45,20,0.15)]">
              <div className="flex items-center justify-between border-b border-warm-border bg-[#fffaf3] px-5 py-4">
                <div>
                  <p className="text-[10px] font-black uppercase tracking-[0.14em] text-orange-deep">Next action</p>
                  <p className="mt-1 text-sm font-black">現在最值得處理</p>
                </div>
                <span className="rounded-full bg-orange-soft px-2.5 py-1 text-[11px] font-black text-orange-deep">未回覆 18 分</span>
              </div>
              <div className="p-5">
                <div className="flex items-start gap-3">
                  <span className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-[#06c755] text-white">
                    <V2Icon name="line" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-3">
                      <p className="font-black">林太太・大安區</p>
                      <span className="rounded-full bg-[#e6effc] px-2 py-1 text-[10px] font-bold text-[#2e5f9f]">冷氣服務</span>
                    </div>
                    <p className="mt-2 text-sm font-bold leading-6">主臥冷氣不冷，已附銘牌與現況照片</p>
                    <p className="mt-1 text-xs leading-5 text-ink-3">希望週六上午到府；地址、聯絡方式與時段已整理。</p>
                  </div>
                </div>
                <div className="mt-5 grid grid-cols-3 gap-2">
                  {["客戶需求", "人工報價", "安排工單"].map((label, index) => (
                    <div key={label} className={`rounded-xl px-2 py-3 text-center ${index === 0 ? "bg-orange-soft" : "bg-bg-warm"}`}>
                      <p className={`font-mono text-xs font-black ${index === 0 ? "text-orange-deep" : "text-ink-3"}`}>0{index + 1}</p>
                      <p className="mt-1 text-[10px] font-bold text-ink-2">{label}</p>
                    </div>
                  ))}
                </div>
                <div className="mt-4 flex min-h-12 items-center justify-center gap-2 rounded-xl bg-ink text-sm font-black text-white">
                  整理這筆進件 <V2Icon name="arrow" className="h-4 w-4" />
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="border-y border-warm-border/70 bg-white/55 px-5 py-6 sm:px-8">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-center gap-2.5">
            <span className="mr-2 text-xs font-black text-ink-3">共通核心，不綁單一產業</span>
            {industries.map((industry) => (
              <span key={industry} className="rounded-full border border-warm-border bg-white px-3 py-1.5 text-xs font-bold text-ink-2">
                {industry}
              </span>
            ))}
          </div>
        </section>

        <section id="workflow" className="mx-auto max-w-6xl scroll-mt-20 px-5 py-16 sm:px-8 sm:py-24">
          <div className="max-w-2xl">
            <p className="text-xs font-black uppercase tracking-[0.16em] text-orange-deep">One traceable flow</p>
            <h2 className="mt-3 text-3xl font-black tracking-[-0.04em] sm:text-4xl">從收到詢問，到留下可回訪的設備履歷</h2>
            <p className="mt-4 text-sm leading-7 text-ink-3 sm:text-base">到府服務與小型工程共用同一條骨架，再由模板補上設備、工序、追加與驗收差異。</p>
          </div>
          <div className="mt-9 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {workflow.map((item) => (
              <article key={item.step} className="rounded-[24px] border border-warm-border bg-white p-5 shadow-[0_12px_35px_rgba(74,45,20,0.055)]">
                <div className="flex items-center justify-between">
                  <span className="inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-orange-soft text-orange-deep">
                    <V2Icon name={item.icon} />
                  </span>
                  <span className="font-mono text-xs font-black text-ink-4">{item.step}</span>
                </div>
                <h3 className="mt-5 text-lg font-black">{item.title}</h3>
                <p className="mt-2 text-sm leading-6 text-ink-3">{item.detail}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="bg-ink px-5 py-16 text-white sm:px-8 sm:py-20">
          <div className="mx-auto grid max-w-6xl gap-8 lg:grid-cols-[1fr_auto] lg:items-center">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.16em] text-orange-soft">Working prototype</p>
              <h2 className="mt-3 max-w-3xl text-3xl font-black leading-tight tracking-[-0.04em] sm:text-4xl">先親手走完流程，再決定哪些功能值得付費開發。</h2>
              <p className="mt-4 max-w-3xl text-sm leading-7 text-white/65 sm:text-base">
                目前版本是完整互動原型與工程基礎，不會真的發 LINE 或寫入客戶資料。它讓試點店家可以具體挑戰報價、派工、現場與追加流程，而不是只看簡報相信一個不存在的 App。
              </p>
            </div>
            <DemoLink secondary />
          </div>
        </section>
      </main>

      <footer className="relative border-t border-warm-border bg-[#f8f2e9] px-5 py-8 sm:px-8">
        <div className="mx-auto flex max-w-6xl flex-col gap-3 text-xs text-ink-3 sm:flex-row sm:items-center sm:justify-between">
          <Logo />
          <p>LINE-first，不是 LINE-only。冷氣是首波模板，不是產品邊界。</p>
        </div>
      </footer>
    </div>
  );
}

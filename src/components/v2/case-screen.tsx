import { getCaseStage, getConfirmedTotal, getQuoteTotal } from "@/lib/v2-demo/store";

import { V2Icon } from "./icons";
import {
  DemoAvatar,
  MetaRow,
  SectionHeading,
  StatusBadge,
  V2Button,
  V2Card,
  formatDemoMoney,
} from "./primitives";
import type { DemoScreenProps } from "./screen-types";

function ChangeOrderPreview({ state, dispatch }: DemoScreenProps) {
  const changeOrder = state.changeOrder;
  if (!changeOrder) return null;

  const statusLabel = {
    draft: "草稿・未對客",
    sent: "等待客戶簽認",
    accepted: "客戶已接受",
  }[changeOrder.status];

  return (
    <V2Card className="overflow-hidden border-brick/20">
      <div className="bg-[linear-gradient(135deg,#41251c_0%,#8f3d25_100%)] p-5 text-white">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-xs font-bold text-white/70">
              <V2Icon name="file" className="h-4 w-4" />
              工程模板能力預覽
            </div>
            <h2 className="mt-2 text-lg font-black">追加／追減簽認</h2>
            <p className="mt-1 text-xs leading-5 text-white/70">另一筆既有工程的平行示範資料</p>
          </div>
          <span className="rounded-full bg-white/12 px-2.5 py-1 text-[11px] font-bold text-white backdrop-blur">
            {statusLabel}
          </span>
        </div>
      </div>
      <div className="p-5">
        <div className="grid gap-4 sm:grid-cols-[1fr_148px]">
          <div>
            <p className="text-sm font-black text-ink">{changeOrder.title}</p>
            <p className="mt-1.5 text-xs leading-5 text-ink-2">{changeOrder.reason}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <StatusBadge tone="orange">追加 {formatDemoMoney(changeOrder.amount)}</StatusBadge>
              <StatusBadge tone="neutral">工期 +{changeOrder.delayDays} 天</StatusBadge>
            </div>
          </div>
          <div className="relative min-h-28 overflow-hidden rounded-2xl bg-[linear-gradient(145deg,#d7c7b5,#745f4b)]">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_30%,rgba(255,255,255,.35),transparent_35%)]" />
            <span className="absolute inset-x-2 bottom-2 rounded-lg bg-black/45 px-2 py-1.5 text-[10px] font-bold text-white backdrop-blur">
              {changeOrder.proofLabel}
            </span>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-3 gap-2 rounded-2xl bg-[#fbf8f3] p-3 text-center">
          <div>
            <p className="font-mono text-xs font-bold text-ink">{formatDemoMoney(getQuoteTotal(state))}</p>
            <p className="mt-1 text-[10px] text-ink-3">原確認</p>
          </div>
          <div>
            <p className="font-mono text-xs font-bold text-brick">+ {formatDemoMoney(changeOrder.amount)}</p>
            <p className="mt-1 text-[10px] text-ink-3">本次追加</p>
          </div>
          <div>
            <p className="font-mono text-xs font-bold text-ink">{formatDemoMoney(getConfirmedTotal(state))}</p>
            <p className="mt-1 text-[10px] text-ink-3">目前確認</p>
          </div>
        </div>

        {changeOrder.status === "draft" ? (
          <V2Button
            className="mt-4 w-full"
            icon="send"
            onClick={() => dispatch({ type: "SEND_CHANGE_ORDER" })}
          >
            送出追加簽認
          </V2Button>
        ) : null}
        {changeOrder.status === "sent" ? (
          <div className="mt-4 space-y-2">
            <p className="rounded-xl bg-[#e6effc] px-3 py-2 text-center text-xs font-bold text-[#2e5f9f]">
              此版本已鎖定，正在等待客戶回覆
            </p>
            <V2Button
              className="w-full"
              icon="check"
              onClick={() => dispatch({ type: "ACCEPT_CHANGE_ORDER" })}
            >
              模擬客戶接受追加
            </V2Button>
          </div>
        ) : null}
        {changeOrder.status === "accepted" ? (
          <div className="mt-4 flex items-center gap-2 rounded-xl bg-[var(--warm-green-soft)] px-3 py-3 text-sm font-bold text-[var(--warm-green)]">
            <V2Icon name="shield" className="h-4 w-4" />
            簽認版本、時間與證據已保留
          </div>
        ) : null}
      </div>
    </V2Card>
  );
}

export function CaseScreen({ state, dispatch }: DemoScreenProps) {
  const { caseRecord } = state;
  const stage = getCaseStage(state);

  return (
    <div className="space-y-5">
      <header>
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge tone="orange">{stage}</StatusBadge>
          <span className="font-mono text-xs font-semibold text-ink-3">{caseRecord.reference}</span>
        </div>
        <h1 className="mt-2 text-[27px] font-black tracking-[-0.04em] text-ink">
          {caseRecord.customerName}・{caseRecord.title}
        </h1>
        <p className="mt-1 text-sm text-ink-3">打開案件，30 秒內看懂現在到哪、下一步由誰處理。</p>
      </header>

      <V2Card className="overflow-hidden">
        <div className="bg-[linear-gradient(135deg,#1f1814_0%,#4a3327_100%)] p-5 text-white">
          <div className="flex items-start gap-3.5">
            <DemoAvatar initial={caseRecord.customerInitial} size="lg" tone="orange" />
            <div className="min-w-0 flex-1">
              <p className="text-lg font-black">{caseRecord.customerName}</p>
              <p className="mt-0.5 text-xs text-white/60">{caseRecord.phone}</p>
              <p className="mt-2 text-sm leading-5 text-white/80">{caseRecord.summary}</p>
            </div>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <span className="rounded-full bg-white/10 px-2.5 py-1 text-[11px] font-bold">
              {caseRecord.serviceLabel}
            </span>
            <span className="rounded-full bg-white/10 px-2.5 py-1 text-[11px] font-bold">
              負責：{caseRecord.ownerName}
            </span>
          </div>
        </div>

        <div className="grid gap-4 p-5 sm:grid-cols-2">
          <div className="space-y-3">
            <MetaRow icon="location">{caseRecord.address}</MetaRow>
            <MetaRow icon="phone">{caseRecord.phone}</MetaRow>
            <MetaRow icon="wrench">{caseRecord.equipmentLabel}</MetaRow>
          </div>
          <div className="rounded-2xl bg-orange-soft/60 p-4">
            <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-orange-deep">下一步</p>
            <p className="mt-1.5 text-sm font-black text-ink">
              {state.quote.status === "accepted" ? "安排技師與服務時段" : "確認範圍並建立報價"}
            </p>
            <p className="mt-1 text-xs leading-5 text-ink-2">
              {state.quote.status === "accepted"
                ? "客戶已接受報價，可以建立一次現場工單。"
                : "報價送出前仍需由老闆人工檢查。"}
            </p>
          </div>
        </div>
      </V2Card>

      <div className="grid grid-cols-3 gap-2.5">
        <div className="rounded-2xl border border-warm-border bg-white p-3.5">
          <p className="font-mono text-base font-black text-ink">{formatDemoMoney(getQuoteTotal(state))}</p>
          <p className="mt-1 text-[11px] text-ink-3">預估金額</p>
        </div>
        <div className="rounded-2xl border border-warm-border bg-white p-3.5">
          <p className="font-mono text-base font-black text-ink">{caseRecord.photoCount}</p>
          <p className="mt-1 text-[11px] text-ink-3">客戶照片</p>
        </div>
        <div className="rounded-2xl border border-warm-border bg-white p-3.5">
          <p className="font-mono text-base font-black text-ink">1</p>
          <p className="mt-1 text-[11px] text-ink-3">下一步待辦</p>
        </div>
      </div>

      <V2Card className="p-5">
        <SectionHeading
          eyebrow="Required action"
          title={state.quote.status === "accepted" ? "客戶已確認，等待派工" : "報價尚未送出"}
          description={
            state.quote.status === "accepted"
              ? "建立工單後，技師只會收到完成工作需要的資料。"
              : "先查看客戶版內容，再由有權限的人員核准。"
          }
        />
        <V2Button
          className="mt-4 w-full"
          icon={state.quote.status === "accepted" ? "calendar" : "quote"}
          onClick={() =>
            dispatch({
              type: "NAVIGATE",
              step: state.quote.status === "accepted" ? "dispatch" : "quote",
            })
          }
        >
          {state.quote.status === "accepted" ? "前往派工" : "建立報價"}
        </V2Button>
      </V2Card>

      {state.template === "project" ? <ChangeOrderPreview state={state} dispatch={dispatch} /> : null}

      <V2Card className="p-5">
        <SectionHeading title="最近歷程" description="重要商業事件不可由一般成員刪除" />
        <div className="mt-4 space-y-4">
          {[...state.timeline].reverse().slice(0, 4).map((event) => (
            <div key={event.id} className="flex gap-3">
              <span
                className={`mt-1.5 h-3 w-3 shrink-0 rounded-full ${
                  event.tone === "green" ? "bg-[var(--warm-green)]" : "bg-orange"
                }`}
              />
              <div>
                <p className="text-sm font-bold text-ink">{event.title}</p>
                <p className="mt-0.5 text-xs leading-5 text-ink-3">{event.detail}</p>
                <p className="mt-1 font-mono text-[10px] text-ink-4">{event.time}</p>
              </div>
            </div>
          ))}
        </div>
      </V2Card>
    </div>
  );
}


import { getMissingCompletionItems } from "@/lib/v2-demo/store";
import type { WorkOrderStatus } from "@/lib/v2-demo/types";

import { V2Icon } from "./icons";
import {
  DemoAvatar,
  MetaRow,
  SectionHeading,
  StatusBadge,
  V2Button,
  V2Card,
} from "./primitives";
import type { DemoScreenProps } from "./screen-types";

const statusCopy: Record<WorkOrderStatus, { label: string; action?: string; tone: "neutral" | "blue" | "orange" | "green" }> = {
  unscheduled: { label: "尚未排程", tone: "neutral" },
  scheduled: { label: "已排程", action: "開始出發", tone: "blue" },
  en_route: { label: "前往現場", action: "我已到場", tone: "orange" },
  on_site: { label: "已到場", action: "開始施工", tone: "orange" },
  in_progress: { label: "施工中", action: "送出待確認", tone: "orange" },
  waiting_confirmation: { label: "待完工確認", tone: "blue" },
  completed: { label: "已完工", tone: "green" },
};

function PhotoSlot({
  kind,
  label,
  caption,
  added,
  disabled,
  onAdd,
}: {
  kind: "before" | "after";
  label: string;
  caption: string;
  added: boolean;
  disabled: boolean;
  onAdd: () => void;
}) {
  return (
    <div className="overflow-hidden rounded-2xl border border-warm-border bg-white">
      <div
        className={`relative aspect-[4/3] overflow-hidden ${
          added
            ? kind === "before"
              ? "bg-[linear-gradient(145deg,#d4c2ac_0%,#8c7159_55%,#4b3c31_100%)]"
              : "bg-[linear-gradient(145deg,#f1eee8_0%,#a8c4bf_55%,#547871_100%)]"
            : "bg-[#f6f0e7]"
        }`}
      >
        {added ? (
          <>
            <div className="absolute left-[18%] top-[18%] h-[45%] w-[64%] rounded-lg border-4 border-white/40 bg-black/10 shadow-xl" />
            <div className="absolute inset-x-3 bottom-3 flex items-center justify-between rounded-xl bg-black/45 px-3 py-2 text-white backdrop-blur">
              <span className="text-xs font-bold">{label}示意</span>
              <span className="flex items-center gap-1 text-[10px]">
                <V2Icon name="cloud" className="h-3.5 w-3.5" /> 已同步
              </span>
            </div>
          </>
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-ink-3">
            <span className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-white">
              <V2Icon name="camera" className="h-5 w-5" />
            </span>
            <span className="mt-2 text-xs font-bold">尚未加入{label}</span>
          </div>
        )}
      </div>
      <div className="p-3">
        <p className="text-xs font-bold text-ink">{caption}</p>
        {!added ? (
          <V2Button
            variant="secondary"
            className="mt-2 w-full"
            icon="plus"
            disabled={disabled}
            onClick={onAdd}
          >
            加入{label}示範照
          </V2Button>
        ) : null}
      </div>
    </div>
  );
}

export function FieldScreen({ state, dispatch }: DemoScreenProps) {
  const status = statusCopy[state.workOrder.status];
  const canRecord = ["on_site", "in_progress", "waiting_confirmation"].includes(
    state.workOrder.status,
  );
  const missingItems = getMissingCompletionItems(state);

  if (state.workOrder.status === "unscheduled") {
    return (
      <div className="space-y-5">
        <header>
          <StatusBadge tone="neutral">技師模式</StatusBadge>
          <h1 className="mt-2 text-[27px] font-black tracking-[-0.04em] text-ink">今日任務</h1>
          <p className="mt-1 text-sm text-ink-3">技師只看自己被指派、完成工作需要的資料。</p>
        </header>
        <V2Card className="flex min-h-[370px] flex-col items-center justify-center px-6 py-12 text-center">
          <span className="inline-flex h-16 w-16 items-center justify-center rounded-[22px] bg-bg-warm text-ink-3">
            <V2Icon name="calendar" className="h-7 w-7" />
          </span>
          <h2 className="mt-5 text-xl font-black text-ink">這張工單還沒派工</h2>
          <p className="mt-2 max-w-sm text-sm leading-6 text-ink-3">
            回到派工台確認時段與負責技師，任務才會出現在技師手機。
          </p>
          <V2Button
            className="mt-6"
            icon="calendar"
            onClick={() => {
              dispatch({ type: "SET_ROLE", role: "dispatcher" });
              dispatch({ type: "NAVIGATE", step: "dispatch" });
            }}
          >
            回到派工
          </V2Button>
        </V2Card>
      </div>
    );
  }

  if (state.workOrder.status === "completed") {
    return (
      <div className="space-y-5">
        <header>
          <StatusBadge tone="green">已完工</StatusBadge>
          <h1 className="mt-2 text-[27px] font-black tracking-[-0.04em] text-ink">現場紀錄已完成</h1>
          <p className="mt-1 text-sm text-ink-3">完整證據已回到案件，不必再從私人 LINE 補資料。</p>
        </header>
        <V2Card className="p-6 text-center">
          <span className="mx-auto inline-flex h-16 w-16 items-center justify-center rounded-[22px] bg-[var(--warm-green-soft)] text-[var(--warm-green)]">
            <V2Icon name="check" className="h-7 w-7" />
          </span>
          <h2 className="mt-4 text-xl font-black text-ink">這張工單已安全完成</h2>
          <p className="mt-2 text-sm leading-6 text-ink-3">查看對客完工摘要與不可變事件時間線。</p>
          <V2Button
            className="mt-5 w-full"
            icon="arrow"
            onClick={() => dispatch({ type: "NAVIGATE", step: "complete" })}
          >
            查看完工摘要
          </V2Button>
        </V2Card>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <header className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
            <span className="font-mono text-[11px] text-ink-3">{state.workOrder.reference}</span>
          </div>
          <h1 className="mt-2 text-[27px] font-black tracking-[-0.04em] text-ink">技師現場</h1>
          <p className="mt-1 text-sm text-ink-3">少打字、清楚下一步；狀態與照片同步分開呈現。</p>
        </div>
        <DemoAvatar initial={state.workOrder.assigneeInitial} size="lg" tone="ink" />
      </header>

      <V2Card className="overflow-hidden">
        <div className="bg-[linear-gradient(135deg,#1a1410_0%,#593825_100%)] p-5 text-white">
          <p className="text-xs font-bold text-orange-soft">下一張任務・{state.workOrder.dateLabel}</p>
          <h2 className="mt-1.5 text-xl font-black">{state.workOrder.title}</h2>
          <p className="mt-1 text-sm text-white/65">
            {state.caseRecord.customerName}・{state.caseRecord.district}
          </p>

          <div className="mt-4 grid grid-cols-3 gap-2">
            {[
              { icon: "route" as const, label: "導航" },
              { icon: "phone" as const, label: "撥號" },
              { icon: "user" as const, label: "聯絡派工" },
            ].map((tool) => (
              <button
                key={tool.label}
                type="button"
                className="flex min-h-12 items-center justify-center gap-1.5 rounded-xl bg-white/10 text-xs font-bold text-white transition hover:bg-white/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange"
              >
                <V2Icon name={tool.icon} className="h-4 w-4" />
                {tool.label}
              </button>
            ))}
          </div>
        </div>

        <div className="grid gap-4 p-5 sm:grid-cols-2">
          <div className="space-y-3">
            <MetaRow icon="clock">
              {state.workOrder.timeWindow}・{state.workOrder.duration}
            </MetaRow>
            <MetaRow icon="location">{state.caseRecord.address}</MetaRow>
          </div>
          <div className="flex items-center justify-between gap-3 rounded-2xl bg-[#fbf8f3] px-4 py-3">
            <div>
              <p className="text-xs font-bold text-ink">同步狀態</p>
              <p className="mt-1 text-[11px] text-ink-3">剛剛已同步・待上傳 0</p>
            </div>
            <V2Icon name="cloud" className="h-5 w-5 text-[var(--warm-green)]" />
          </div>
        </div>

        {status.action ? (
          <div className="border-t border-warm-border p-4">
            <V2Button
              className="w-full"
              icon={state.workOrder.status === "en_route" ? "location" : "arrow"}
              onClick={() => dispatch({ type: "ADVANCE_WORK_ORDER" })}
            >
              {status.action}
            </V2Button>
          </div>
        ) : null}
      </V2Card>

      <V2Card className="p-5">
        <SectionHeading
          eyebrow="Required checklist"
          title="現場檢查"
          description={canRecord ? "完成必要項目後才能送出完工。" : "到場後開放填寫，避免提前誤記。"}
          right={<StatusBadge tone={state.checklist.every((item) => item.complete) ? "green" : "orange"}>{state.checklist.filter((item) => item.complete).length}/{state.checklist.length}</StatusBadge>}
        />
        <fieldset disabled={!canRecord} className="mt-4 space-y-2.5 disabled:opacity-55">
          <legend className="sr-only">必要現場檢查項目</legend>
          {state.checklist.map((item) => (
            <label
              key={item.id}
              className="flex min-h-[64px] cursor-pointer items-center gap-3 rounded-2xl border border-warm-border bg-white px-3.5 py-3 transition hover:border-orange/35"
            >
              <input
                type="checkbox"
                checked={item.complete}
                onChange={() => dispatch({ type: "TOGGLE_CHECKLIST", id: item.id })}
                className="h-5 w-5 shrink-0 rounded border-warm-border-strong accent-orange"
              />
              <span className="min-w-0 flex-1">
                <span className={`block text-sm font-bold ${item.complete ? "text-ink-3 line-through" : "text-ink"}`}>
                  {item.label}
                </span>
                <span className="mt-0.5 block text-[11px] leading-4 text-ink-3">{item.hint}</span>
              </span>
              {item.complete ? <V2Icon name="check" className="h-4 w-4 text-[var(--warm-green)]" /> : null}
            </label>
          ))}
        </fieldset>
      </V2Card>

      <V2Card className="p-5">
        <SectionHeading
          eyebrow="Photo evidence"
          title="施工前後照"
          description="原型使用示意圖；正式版會顯示本機、待同步與已同步狀態。"
        />
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {state.photos.map((photo) => (
            <PhotoSlot
              key={photo.id}
              {...photo}
              disabled={!canRecord}
              onAdd={() => dispatch({ type: "ADD_DEMO_PHOTO", kind: photo.kind })}
            />
          ))}
        </div>
      </V2Card>

      {state.workOrder.status === "waiting_confirmation" ? (
        <V2Card className="p-5">
          <SectionHeading
            eyebrow="Completion gate"
            title="完工前確認"
            description="送出後會形成完整事件與證據，不以畫面假成功代替。"
          />
          {missingItems.length > 0 ? (
            <div className="mt-4 rounded-2xl bg-[var(--warm-red-soft)] p-4">
              <p className="flex items-center gap-2 text-sm font-bold text-[var(--warm-red)]">
                <V2Icon name="alert" className="h-4 w-4" />
                還缺 {missingItems.length} 項
              </p>
              <ul className="mt-2 grid gap-1 text-xs leading-5 text-ink-2 sm:grid-cols-2">
                {missingItems.map((item) => (
                  <li key={item}>・{item}</li>
                ))}
              </ul>
            </div>
          ) : (
            <div className="mt-4 flex items-center gap-2 rounded-2xl bg-[var(--warm-green-soft)] p-4 text-sm font-bold text-[var(--warm-green)]">
              <V2Icon name="check" className="h-4 w-4" />
              必要紀錄已齊全，可以安全完工
            </div>
          )}
          <V2Button
            className="mt-4 w-full"
            icon="check"
            onClick={() => dispatch({ type: "COMPLETE_WORK_ORDER" })}
          >
            確認完工
          </V2Button>
        </V2Card>
      ) : null}
    </div>
  );
}


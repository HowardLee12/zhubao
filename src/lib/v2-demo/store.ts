import { createDemoFixture } from "./fixtures";
import type {
  DemoAction,
  DemoState,
  DemoTemplate,
  DemoTimelineItem,
  WorkOrderStatus,
} from "./types";

const workOrderSequence: WorkOrderStatus[] = [
  "scheduled",
  "en_route",
  "on_site",
  "in_progress",
  "waiting_confirmation",
];

const workOrderEvents: Partial<Record<WorkOrderStatus, string>> = {
  scheduled: "工單已排程",
  en_route: "技師已出發",
  on_site: "技師已到場",
  in_progress: "現場施工中",
  waiting_confirmation: "工單待完工確認",
  completed: "工單已完成",
};

function timelineItem(
  title: string,
  detail: string,
  tone: DemoTimelineItem["tone"] = "orange",
): DemoTimelineItem {
  return {
    id: `event-${title}-${Math.random().toString(36).slice(2, 8)}`,
    title,
    detail,
    time: "剛剛",
    tone,
  };
}

export function createInitialDemoState(template: DemoTemplate = "service"): DemoState {
  return {
    template,
    activeRole: "dispatcher",
    currentStep: "inbox",
    viewState: "ready",
    intakeProcessed: false,
    ...createDemoFixture(template),
    notice: null,
  };
}

export function getQuoteTotal(state: DemoState): number {
  return state.quote.lines.reduce(
    (total, line) => total + line.quantity * line.unitPrice,
    0,
  );
}

export function getQuoteCost(state: DemoState): number {
  return state.quote.lines.reduce(
    (total, line) => total + line.quantity * line.internalCost,
    0,
  );
}

export function getConfirmedTotal(state: DemoState): number {
  const base = getQuoteTotal(state);
  const changeAmount =
    state.changeOrder?.status === "accepted" ? state.changeOrder.amount : 0;
  return base + changeAmount;
}

export function getMissingCompletionItems(state: DemoState): string[] {
  const checklistItems = state.checklist
    .filter((item) => !item.complete)
    .map((item) => item.label);
  const missingPhotos = state.photos
    .filter((photo) => !photo.added)
    .map((photo) => `${photo.label}照片`);

  return [...checklistItems, ...missingPhotos];
}

export function getCaseStage(state: DemoState): string {
  if (state.workOrder.status === "completed") return "已完成";
  if (state.workOrder.status === "waiting_confirmation") return "待驗收";
  if (["on_site", "in_progress"].includes(state.workOrder.status)) {
    return "進行中";
  }
  if (["scheduled", "en_route"].includes(state.workOrder.status)) return "已排程";
  if (state.quote.status === "accepted") return "待排程";
  if (state.quote.status === "sent") return "待客戶確認";
  if (state.intakeProcessed) return "待報價";
  return "待處理";
}

function advanceWorkOrder(state: DemoState): DemoState {
  const currentIndex = workOrderSequence.indexOf(state.workOrder.status);
  const nextStatus =
    state.workOrder.status === "unscheduled"
      ? "scheduled"
      : workOrderSequence[Math.min(currentIndex + 1, workOrderSequence.length - 1)];
  const title = workOrderEvents[nextStatus] ?? "工單已更新";

  return {
    ...state,
    workOrder: { ...state.workOrder, status: nextStatus },
    notice: { tone: "success", message: `${title}，紀錄已保存在示範狀態。` },
    timeline: [
      ...state.timeline,
      timelineItem(title, `${state.workOrder.assigneeName}・${state.workOrder.reference}`),
    ],
  };
}

export function demoReducer(state: DemoState, action: DemoAction): DemoState {
  switch (action.type) {
    case "NAVIGATE":
      return { ...state, currentStep: action.step, notice: null };
    case "SWITCH_TEMPLATE":
      return createInitialDemoState(action.template);
    case "SET_ROLE":
      return {
        ...state,
        activeRole: action.role,
        currentStep: action.role === "technician" ? "field" : state.currentStep,
        notice: null,
      };
    case "SET_VIEW_STATE":
      return { ...state, viewState: action.viewState };
    case "PROCESS_INTAKE":
      return {
        ...state,
        intakeProcessed: true,
        currentStep: "case",
        notice: { tone: "success", message: "進件已整理成案件，原始需求仍完整保留。" },
        timeline: [
          ...state.timeline,
          timelineItem("進件已整理成案件", `${state.caseRecord.ownerName} 負責下一步`),
        ],
      };
    case "START_QUOTE":
      return { ...state, currentStep: "quote", notice: null };
    case "SET_QUOTE_CONFIRMED":
      return {
        ...state,
        quote: { ...state.quote, humanConfirmed: action.value },
        notice: null,
      };
    case "APPROVE_QUOTE":
      if (!state.quote.humanConfirmed) {
        return {
          ...state,
          notice: { tone: "danger", message: "請先勾選人工確認，再送出報價。" },
        };
      }
      return {
        ...state,
        quote: { ...state.quote, status: "sent" },
        notice: { tone: "success", message: "報價已由王老闆核准並建立不可變版本。" },
        timeline: [
          ...state.timeline,
          timelineItem("報價已核准並送出", `${state.quote.reference}・等待客戶確認`),
        ],
      };
    case "ACCEPT_QUOTE":
      if (state.quote.status !== "sent") return state;
      return {
        ...state,
        quote: { ...state.quote, status: "accepted" },
        currentStep: "dispatch",
        notice: { tone: "success", message: "客戶已接受此版本，案件可以安排工單。" },
        timeline: [
          ...state.timeline,
          timelineItem("客戶已接受報價", `版本 v${state.quote.version}・確認金額`, "green"),
        ],
      };
    case "SET_ASSIGNEE": {
      const technician = state.technicians.find(
        (candidate) => candidate.id === action.technicianId,
      );
      if (!technician) return state;
      return {
        ...state,
        workOrder: {
          ...state.workOrder,
          assigneeId: technician.id,
          assigneeName: technician.name,
          assigneeInitial: technician.initial,
        },
        notice: null,
      };
    }
    case "SCHEDULE_WORK_ORDER": {
      const technician = state.technicians.find(
        (candidate) => candidate.id === state.workOrder.assigneeId,
      );
      if (technician?.hasConflict) {
        return {
          ...state,
          notice: { tone: "danger", message: "這個時段已有工單，請改派或調整時間。" },
        };
      }
      return {
        ...state,
        activeRole: "technician",
        currentStep: "field",
        workOrder: { ...state.workOrder, status: "scheduled" },
        notice: { tone: "success", message: "派工完成，已切換成技師手機視角。" },
        timeline: [
          ...state.timeline,
          timelineItem(
            "工單已排程",
            `${state.workOrder.dateLabel} ${state.workOrder.timeWindow}・${state.workOrder.assigneeName}`,
          ),
        ],
      };
    }
    case "ADVANCE_WORK_ORDER":
      return advanceWorkOrder(state);
    case "TOGGLE_CHECKLIST":
      return {
        ...state,
        checklist: state.checklist.map((item) =>
          item.id === action.id ? { ...item, complete: !item.complete } : item,
        ),
        notice: null,
      };
    case "ADD_DEMO_PHOTO":
      return {
        ...state,
        photos: state.photos.map((photo) =>
          photo.kind === action.kind
            ? { ...photo, added: true, caption: `${photo.label}示範照・已同步` }
            : photo,
        ),
        notice: { tone: "success", message: `${action.kind === "before" ? "施工前" : "施工後"}示範照已加入。` },
      };
    case "COMPLETE_WORK_ORDER": {
      const missing = getMissingCompletionItems(state);
      if (missing.length > 0) {
        return {
          ...state,
          notice: {
            tone: "danger",
            message: `還缺 ${missing.length} 項完工紀錄，資料尚未送出。`,
          },
        };
      }
      return {
        ...state,
        activeRole: "dispatcher",
        currentStep: "complete",
        workOrder: { ...state.workOrder, status: "completed" },
        notice: { tone: "success", message: "工單已完工，完整證據與時間線已保存。" },
        timeline: [
          ...state.timeline,
          timelineItem("工單已完成", "必要照片與檢查表均已確認", "green"),
        ],
      };
    }
    case "SEND_CHANGE_ORDER":
      if (!state.changeOrder || state.changeOrder.status !== "draft") return state;
      return {
        ...state,
        changeOrder: { ...state.changeOrder, status: "sent" },
        notice: { tone: "success", message: "追加單已送出；此版本現在不可原地修改。" },
        timeline: [
          ...state.timeline,
          timelineItem("追加簽認已送出", `${state.changeOrder.reference}・等待客戶確認`),
        ],
      };
    case "ACCEPT_CHANGE_ORDER":
      if (!state.changeOrder || state.changeOrder.status !== "sent") return state;
      return {
        ...state,
        changeOrder: { ...state.changeOrder, status: "accepted" },
        notice: { tone: "success", message: "客戶已接受追加，確認總額已更新。" },
        timeline: [
          ...state.timeline,
          timelineItem("客戶已接受追加", `${state.changeOrder.reference}・版本已鎖定`, "green"),
        ],
      };
    case "CLEAR_NOTICE":
      return { ...state, notice: null };
    case "RESET":
      return createInitialDemoState(state.template);
    default:
      return state;
  }
}

export type DemoTemplate = "service" | "project";
export type DemoRole = "dispatcher" | "technician";
export type DemoStep =
  | "inbox"
  | "case"
  | "quote"
  | "dispatch"
  | "field"
  | "complete";
export type DemoViewState = "ready" | "loading" | "empty" | "error";

export type QuoteStatus = "draft" | "sent" | "accepted";
export type WorkOrderStatus =
  | "unscheduled"
  | "scheduled"
  | "en_route"
  | "on_site"
  | "in_progress"
  | "waiting_confirmation"
  | "completed";
export type ChangeOrderStatus = "draft" | "sent" | "accepted";

export interface DemoNotice {
  tone: "success" | "danger" | "info";
  message: string;
}

export interface DemoCaseRecord {
  id: string;
  reference: string;
  title: string;
  customerName: string;
  customerInitial: string;
  phone: string;
  address: string;
  district: string;
  receivedAt: string;
  source: "LINE" | "電話";
  serviceLabel: string;
  summary: string;
  details: string[];
  photoCount: number;
  equipmentLabel: string;
  ownerName: string;
}

export interface QuoteLine {
  id: string;
  name: string;
  detail: string;
  quantity: number;
  unit: string;
  unitPrice: number;
  internalCost: number;
}

export interface DemoQuote {
  reference: string;
  version: number;
  status: QuoteStatus;
  validUntil: string;
  lines: QuoteLine[];
  humanConfirmed: boolean;
  customerMessage: string;
}

export interface DemoWorkOrder {
  reference: string;
  title: string;
  status: WorkOrderStatus;
  dateLabel: string;
  timeWindow: string;
  duration: string;
  assigneeId: string;
  assigneeName: string;
  assigneeInitial: string;
}

export interface DemoTechnician {
  id: string;
  name: string;
  initial: string;
  specialty: string;
  availability: string;
  hasConflict: boolean;
}

export interface DemoChecklistItem {
  id: string;
  label: string;
  hint: string;
  complete: boolean;
}

export interface DemoPhoto {
  id: string;
  kind: "before" | "after";
  label: string;
  caption: string;
  added: boolean;
}

export interface DemoChangeOrder {
  reference: string;
  title: string;
  reason: string;
  amount: number;
  delayDays: number;
  status: ChangeOrderStatus;
  proofLabel: string;
}

export interface DemoTimelineItem {
  id: string;
  title: string;
  detail: string;
  time: string;
  tone: "neutral" | "orange" | "green";
}

export interface DemoState {
  template: DemoTemplate;
  activeRole: DemoRole;
  currentStep: DemoStep;
  viewState: DemoViewState;
  intakeProcessed: boolean;
  caseRecord: DemoCaseRecord;
  quote: DemoQuote;
  workOrder: DemoWorkOrder;
  technicians: DemoTechnician[];
  checklist: DemoChecklistItem[];
  photos: DemoPhoto[];
  changeOrder: DemoChangeOrder | null;
  timeline: DemoTimelineItem[];
  notice: DemoNotice | null;
}

export type DemoAction =
  | { type: "NAVIGATE"; step: DemoStep }
  | { type: "SWITCH_TEMPLATE"; template: DemoTemplate }
  | { type: "SET_ROLE"; role: DemoRole }
  | { type: "SET_VIEW_STATE"; viewState: DemoViewState }
  | { type: "PROCESS_INTAKE" }
  | { type: "START_QUOTE" }
  | { type: "SET_QUOTE_CONFIRMED"; value: boolean }
  | { type: "APPROVE_QUOTE" }
  | { type: "ACCEPT_QUOTE" }
  | { type: "SET_ASSIGNEE"; technicianId: string }
  | { type: "SCHEDULE_WORK_ORDER" }
  | { type: "ADVANCE_WORK_ORDER" }
  | { type: "TOGGLE_CHECKLIST"; id: string }
  | { type: "ADD_DEMO_PHOTO"; kind: DemoPhoto["kind"] }
  | { type: "COMPLETE_WORK_ORDER" }
  | { type: "SEND_CHANGE_ORDER" }
  | { type: "ACCEPT_CHANGE_ORDER" }
  | { type: "CLEAR_NOTICE" }
  | { type: "RESET" };


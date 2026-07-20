import type { LineMessage } from "./client";

// LINE message template registry. Only allowlisted templates can be rendered, and
// user-supplied text is placed EXCLUSIVELY into a message's `text` field via object
// construction — never string-concatenated into JSON. That is the injection boundary:
// a hostile customer name cannot escape the text slot to alter `to`, add messages, or
// reshape the payload, because we build plain JS objects and let JSON.stringify (in
// the HTTP layer) do the escaping.

export const TEMPLATE_KEYS = [
  "received",
  "quote_sent",
  "appointment_confirmed",
  "en_route",
  "completed",
  "payment_reminder",
] as const;

export type TemplateKey = (typeof TEMPLATE_KEYS)[number];

// Every field is an already-resolved display string produced by the enqueue caller.
// Missing fields fall back to a neutral placeholder so a template never emits the
// literal "undefined".
export interface TemplateVars {
  customerName?: string;
  quoteNumber?: string;
  amountLabel?: string;
  scheduledAt?: string;
  workOrderNumber?: string;
  technicianName?: string;
}

const LINE_TEXT_MAX = 5000;

const TEMPLATE_KEY_SET: ReadonlySet<string> = new Set(TEMPLATE_KEYS);

export function isKnownTemplateKey(key: string): key is TemplateKey {
  return TEMPLATE_KEY_SET.has(key);
}

function value(v: string | undefined, fallback: string): string {
  const trimmed = v?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : fallback;
}

// Build a single text message. `text` is the ONLY sink for interpolated values, and
// it is length-capped to LINE's per-message ceiling.
function text(body: string): LineMessage {
  return { type: "text", text: body.slice(0, LINE_TEXT_MAX) };
}

const RENDERERS: Record<TemplateKey, (vars: TemplateVars) => LineMessage[]> = {
  received: (vars) => [
    text(`${value(vars.customerName, "您好")}，我們已收到您的服務需求，將盡快與您聯繫安排。`),
  ],
  quote_sent: (vars) => [
    text(
      `${value(vars.customerName, "您好")}，您的報價單 ${value(vars.quoteNumber, "")} 已送出，` +
        `金額 ${value(vars.amountLabel, "")}。請於 LINE 查看並確認。`,
    ),
  ],
  appointment_confirmed: (vars) => [
    text(
      `${value(vars.customerName, "您好")}，您的預約已確認，時間為 ${value(vars.scheduledAt, "")}，` +
        `工單 ${value(vars.workOrderNumber, "")}。`,
    ),
  ],
  en_route: (vars) => [
    text(
      `${value(vars.customerName, "您好")}，師傅 ${value(vars.technicianName, "")} 已出發，` +
        `即將前往為您服務。`,
    ),
  ],
  completed: (vars) => [
    text(`${value(vars.customerName, "您好")}，工單 ${value(vars.workOrderNumber, "")} 已完工，感謝您的支持。`),
  ],
  payment_reminder: (vars) => [
    text(
      `${value(vars.customerName, "您好")}，提醒您工單 ${value(vars.workOrderNumber, "")} 的款項 ` +
        `${value(vars.amountLabel, "")} 尚待付款，感謝您。`,
    ),
  ],
};

export function renderLineTemplate(key: TemplateKey, vars: TemplateVars): LineMessage[] {
  const renderer = RENDERERS[key];
  if (!renderer) {
    throw new Error(`Unknown template key: ${String(key)}`);
  }
  return renderer(vars);
}

import type { SupabaseClient } from "@supabase/supabase-js";

import { mapOperationsRpcError } from "@/server/api/operations-errors";
import { internalApiProblem } from "@/server/supabase/http";
import type {
  CreatePaymentMilestoneInput,
  InvoicePaymentMilestoneInput,
  MarkPaymentMilestonePaidInput,
  ReasonPaymentMilestoneInput,
} from "@/schemas/payment-milestone";

type Rpc = Pick<SupabaseClient, "rpc">;

type JsonRecord = Record<string, unknown>;

function requireObject(data: unknown): JsonRecord {
  if (!data || typeof data !== "object" || Array.isArray(data)) throw internalApiProblem();
  return data as JsonRecord;
}

export async function createPaymentMilestone(command: {
  supabase: Rpc;
  organizationId: string;
  input: CreatePaymentMilestoneInput;
  requestId: string;
}): Promise<JsonRecord> {
  const { input } = command;
  const { data, error } = await command.supabase.rpc("create_payment_milestone", {
    target_org: command.organizationId,
    p_project_id: input.projectId,
    p_name: input.name,
    p_amount_minor: input.amountMinor,
    p_due_on: input.dueOn ?? null,
    p_quote_version_id: input.quoteVersionId ?? null,
    p_change_order_id: input.changeOrderId ?? null,
    p_currency: input.currency ?? "TWD",
    p_notes: input.notes ?? "",
    p_occurred_at: input.occurredAt ?? null,
    p_request_id: command.requestId,
  });
  if (error) throw mapOperationsRpcError(error);
  return requireObject(data);
}

export async function invoicePaymentMilestone(command: {
  supabase: Rpc;
  organizationId: string;
  milestoneId: string;
  expectedLockVersion: number;
  input: InvoicePaymentMilestoneInput;
  idempotencyKey: string;
  requestId: string;
}): Promise<JsonRecord> {
  const { data, error } = await command.supabase.rpc("invoice_payment_milestone", {
    target_org: command.organizationId,
    target_milestone: command.milestoneId,
    p_expected_lock_version: command.expectedLockVersion,
    p_due_on: command.input.dueOn ?? null,
    p_occurred_at: command.input.occurredAt ?? null,
    p_idempotency_key: command.idempotencyKey,
    p_request_id: command.requestId,
  });
  if (error) throw mapOperationsRpcError(error);
  return requireObject(data);
}

export async function markPaymentMilestonePaid(command: {
  supabase: Rpc;
  organizationId: string;
  milestoneId: string;
  expectedLockVersion: number;
  input: MarkPaymentMilestonePaidInput;
  idempotencyKey: string;
  requestId: string;
}): Promise<JsonRecord> {
  const { input } = command;
  const { data, error } = await command.supabase.rpc("mark_payment_milestone_paid", {
    target_org: command.organizationId,
    target_milestone: command.milestoneId,
    p_expected_lock_version: command.expectedLockVersion,
    p_payment_method: input.paymentMethod ?? null,
    p_external_reference: input.externalReference ?? null,
    p_paid_at: input.paidAt ?? null,
    p_metadata: input.metadata ?? {},
    p_occurred_at: input.occurredAt ?? null,
    p_idempotency_key: command.idempotencyKey,
    p_request_id: command.requestId,
  });
  if (error) throw mapOperationsRpcError(error);
  return requireObject(data);
}

async function reasonAction(
  rpcName:
    | "waive_payment_milestone"
    | "cancel_payment_milestone"
    | "reverse_payment_milestone",
  command: {
    supabase: Rpc;
    organizationId: string;
    milestoneId: string;
    expectedLockVersion: number;
    input: ReasonPaymentMilestoneInput;
    idempotencyKey: string;
    requestId: string;
  },
): Promise<JsonRecord> {
  const { data, error } = await command.supabase.rpc(rpcName, {
    target_org: command.organizationId,
    target_milestone: command.milestoneId,
    p_expected_lock_version: command.expectedLockVersion,
    p_reason: command.input.reason,
    p_occurred_at: command.input.occurredAt ?? null,
    p_idempotency_key: command.idempotencyKey,
    p_request_id: command.requestId,
  });
  if (error) throw mapOperationsRpcError(error);
  return requireObject(data);
}

export function waivePaymentMilestone(
  command: Parameters<typeof reasonAction>[1],
): Promise<JsonRecord> {
  return reasonAction("waive_payment_milestone", command);
}

export function cancelPaymentMilestone(
  command: Parameters<typeof reasonAction>[1],
): Promise<JsonRecord> {
  return reasonAction("cancel_payment_milestone", command);
}

export function reversePaymentMilestone(
  command: Parameters<typeof reasonAction>[1],
): Promise<JsonRecord> {
  return reasonAction("reverse_payment_milestone", command);
}

export async function listPaymentMilestones(command: {
  supabase: Rpc;
  organizationId: string;
  projectId?: string | null;
  status?: string | null;
  limit?: number;
}): Promise<JsonRecord> {
  const { data, error } = await command.supabase.rpc("list_pilot_payment_milestones", {
    target_org: command.organizationId,
    p_project_id: command.projectId ?? null,
    p_status: command.status ?? null,
    p_limit: command.limit ?? 50,
  });
  if (error) throw mapOperationsRpcError(error);
  return requireObject(data);
}

export async function getPaymentMilestoneDetail(command: {
  supabase: Rpc;
  organizationId: string;
  milestoneId: string;
}): Promise<JsonRecord> {
  const { data, error } = await command.supabase.rpc(
    "get_pilot_payment_milestone_detail",
    {
      target_org: command.organizationId,
      target_milestone: command.milestoneId,
    },
  );
  if (error) throw mapOperationsRpcError(error);
  return requireObject(data);
}

// Worker-only: flip invoiced+past-due milestones to overdue. Idempotent and keyed
// on the org-local calendar day inside the RPC. service_role client.
export async function markPaymentsOverdue(command: {
  supabase: Rpc;
  now?: string;
  limit?: number;
}): Promise<JsonRecord> {
  const { data, error } = await command.supabase.rpc("mark_payments_overdue", {
    p_now: command.now ?? null,
    p_limit: command.limit ?? 500,
  });
  if (error) throw mapOperationsRpcError(error);
  return requireObject(data);
}

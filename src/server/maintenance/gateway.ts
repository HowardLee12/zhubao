import type { SupabaseClient } from "@supabase/supabase-js";

import { mapOperationsRpcError } from "@/server/api/operations-errors";
import { internalApiProblem } from "@/server/supabase/http";
import type {
  ApproveNotificationsInput,
  CompleteMaintenancePlanInput,
  ConvertMaintenancePlanInput,
  CreateMaintenancePlanInput,
  PatchMaintenancePlanInput,
  PrepareMaintenanceRemindersInput,
} from "@/schemas/maintenance-plan";

type Rpc = Pick<SupabaseClient, "rpc">;
type JsonRecord = Record<string, unknown>;

function requireObject(data: unknown): JsonRecord {
  if (!data || typeof data !== "object" || Array.isArray(data)) throw internalApiProblem();
  return data as JsonRecord;
}

export async function createMaintenancePlan(command: {
  supabase: Rpc;
  organizationId: string;
  input: CreateMaintenancePlanInput;
  requestId: string;
}): Promise<JsonRecord> {
  const { input } = command;
  const { data, error } = await command.supabase.rpc("create_maintenance_plan", {
    target_org: command.organizationId,
    p_customer_id: input.customerId,
    p_location_id: input.locationId,
    p_name: input.name,
    p_cadence_months: input.cadenceMonths,
    p_next_due_on: input.nextDueOn,
    p_asset_id: input.assetId ?? null,
    p_service_catalog_item_id: input.serviceCatalogItemId ?? null,
    p_lead_days: input.leadDays ?? 14,
    p_auto_prepare_message: input.autoPrepareMessage ?? true,
    p_occurred_at: input.occurredAt ?? null,
    p_request_id: command.requestId,
  });
  if (error) throw mapOperationsRpcError(error);
  return requireObject(data);
}

export async function patchMaintenancePlan(command: {
  supabase: Rpc;
  organizationId: string;
  planId: string;
  expectedLockVersion: number;
  input: PatchMaintenancePlanInput;
  requestId: string;
}): Promise<JsonRecord> {
  const { input } = command;
  const { data, error } = await command.supabase.rpc("patch_maintenance_plan", {
    target_org: command.organizationId,
    target_plan: command.planId,
    p_expected_lock_version: command.expectedLockVersion,
    p_name: input.name ?? null,
    p_cadence_months: input.cadenceMonths ?? null,
    p_lead_days: input.leadDays ?? null,
    p_next_due_on: input.nextDueOn ?? null,
    p_auto_prepare_message: input.autoPrepareMessage ?? null,
    p_occurred_at: input.occurredAt ?? null,
    p_request_id: command.requestId,
  });
  if (error) throw mapOperationsRpcError(error);
  return requireObject(data);
}

async function simpleTransition(
  rpcName: "pause_maintenance_plan" | "resume_maintenance_plan",
  command: {
    supabase: Rpc;
    organizationId: string;
    planId: string;
    expectedLockVersion: number;
    occurredAt?: string;
    requestId: string;
  },
): Promise<JsonRecord> {
  const { data, error } = await command.supabase.rpc(rpcName, {
    target_org: command.organizationId,
    target_plan: command.planId,
    p_expected_lock_version: command.expectedLockVersion,
    p_occurred_at: command.occurredAt ?? null,
    p_request_id: command.requestId,
  });
  if (error) throw mapOperationsRpcError(error);
  return requireObject(data);
}

export function pauseMaintenancePlan(
  command: Parameters<typeof simpleTransition>[1],
): Promise<JsonRecord> {
  return simpleTransition("pause_maintenance_plan", command);
}

export function resumeMaintenancePlan(
  command: Parameters<typeof simpleTransition>[1],
): Promise<JsonRecord> {
  return simpleTransition("resume_maintenance_plan", command);
}

export async function cancelMaintenancePlan(command: {
  supabase: Rpc;
  organizationId: string;
  planId: string;
  expectedLockVersion: number;
  reason: string;
  occurredAt?: string;
  requestId: string;
}): Promise<JsonRecord> {
  const { data, error } = await command.supabase.rpc("cancel_maintenance_plan", {
    target_org: command.organizationId,
    target_plan: command.planId,
    p_expected_lock_version: command.expectedLockVersion,
    p_reason: command.reason,
    p_occurred_at: command.occurredAt ?? null,
    p_request_id: command.requestId,
  });
  if (error) throw mapOperationsRpcError(error);
  return requireObject(data);
}

export async function completeMaintenancePlan(command: {
  supabase: Rpc;
  organizationId: string;
  planId: string;
  expectedLockVersion: number;
  input: CompleteMaintenancePlanInput;
  requestId: string;
}): Promise<JsonRecord> {
  const { input } = command;
  const { data, error } = await command.supabase.rpc("complete_maintenance_plan", {
    target_org: command.organizationId,
    target_plan: command.planId,
    p_expected_lock_version: command.expectedLockVersion,
    p_completed_work_order_id: input.completedWorkOrderId ?? null,
    p_completed_on: input.completedOn ?? null,
    p_occurred_at: input.occurredAt ?? null,
    p_request_id: command.requestId,
  });
  if (error) throw mapOperationsRpcError(error);
  return requireObject(data);
}

// Draft-only. Enqueues an approval-pending reminder per plan; it never auto-sends.
export async function prepareMaintenanceReminders(command: {
  supabase: Rpc;
  organizationId: string;
  input: PrepareMaintenanceRemindersInput;
  requestId: string;
}): Promise<JsonRecord> {
  const { data, error } = await command.supabase.rpc("prepare_maintenance_reminders", {
    target_org: command.organizationId,
    p_plan_ids: command.input.planIds,
    p_occurred_at: command.input.occurredAt ?? null,
    p_request_id: command.requestId,
  });
  if (error) throw mapOperationsRpcError(error);
  return requireObject(data);
}

export async function approveNotifications(command: {
  supabase: Rpc;
  organizationId: string;
  input: ApproveNotificationsInput;
  requestId: string;
}): Promise<JsonRecord> {
  const { data, error } = await command.supabase.rpc("approve_notifications", {
    target_org: command.organizationId,
    p_notification_ids: command.input.notificationIds,
    p_occurred_at: command.input.occurredAt ?? null,
    p_request_id: command.requestId,
  });
  if (error) throw mapOperationsRpcError(error);
  return requireObject(data);
}

export async function convertMaintenancePlanToRequest(command: {
  supabase: Rpc;
  organizationId: string;
  planId: string;
  expectedLockVersion: number;
  input: ConvertMaintenancePlanInput;
  idempotencyKey: string;
  requestId: string;
}): Promise<JsonRecord> {
  const { input } = command;
  const { data, error } = await command.supabase.rpc(
    "convert_maintenance_plan_to_request",
    {
      target_org: command.organizationId,
      target_plan: command.planId,
      p_expected_lock_version: command.expectedLockVersion,
      p_subject: input.subject ?? null,
      p_description: input.description ?? "",
      p_force: input.force ?? false,
      p_occurred_at: input.occurredAt ?? null,
      p_idempotency_key: command.idempotencyKey,
      p_request_id: command.requestId,
    },
  );
  if (error) throw mapOperationsRpcError(error);
  return requireObject(data);
}

export async function listMaintenancePlans(command: {
  supabase: Rpc;
  organizationId: string;
  status?: string | null;
  limit?: number;
}): Promise<JsonRecord> {
  const { data, error } = await command.supabase.rpc("list_pilot_maintenance_plans", {
    target_org: command.organizationId,
    p_status: command.status ?? null,
    p_limit: command.limit ?? 50,
  });
  if (error) throw mapOperationsRpcError(error);
  return requireObject(data);
}

export async function getMaintenancePlanDetail(command: {
  supabase: Rpc;
  organizationId: string;
  planId: string;
}): Promise<JsonRecord> {
  const { data, error } = await command.supabase.rpc(
    "get_pilot_maintenance_plan_detail",
    {
      target_org: command.organizationId,
      target_plan: command.planId,
    },
  );
  if (error) throw mapOperationsRpcError(error);
  return requireObject(data);
}

// Worker-only: scan due plans and enqueue approval-pending reminders. Idempotent.
export async function scanMaintenanceDue(command: {
  supabase: Rpc;
  now?: string;
  limit?: number;
}): Promise<JsonRecord> {
  const { data, error } = await command.supabase.rpc("scan_maintenance_due", {
    p_now: command.now ?? null,
    p_limit: command.limit ?? 200,
  });
  if (error) throw mapOperationsRpcError(error);
  return requireObject(data);
}

import type { SupabaseClient } from "@supabase/supabase-js";

import { mapOperationsRpcError } from "@/server/api/operations-errors";
import { internalApiProblem } from "@/server/supabase/http";
import type {
  AppendAssetServiceEventInput,
  PatchAssetInput,
  RetireAssetInput,
} from "@/schemas/asset";

type Rpc = Pick<SupabaseClient, "rpc">;
type JsonRecord = Record<string, unknown>;

function requireObject(data: unknown): JsonRecord {
  if (!data || typeof data !== "object" || Array.isArray(data)) throw internalApiProblem();
  return data as JsonRecord;
}

export async function patchAsset(command: {
  supabase: Rpc;
  organizationId: string;
  assetId: string;
  expectedLockVersion: number;
  input: PatchAssetInput;
  requestId: string;
}): Promise<JsonRecord> {
  const { input } = command;
  const { data, error } = await command.supabase.rpc("patch_asset", {
    target_org: command.organizationId,
    target_asset: command.assetId,
    p_expected_lock_version: command.expectedLockVersion,
    p_name: input.name ?? null,
    p_brand: input.brand ?? null,
    p_model: input.model ?? null,
    p_serial_number: input.serialNumber ?? null,
    p_installed_on: input.installedOn ?? null,
    p_warranty_expires_on: input.warrantyExpiresOn ?? null,
    p_occurred_at: input.occurredAt ?? null,
    p_request_id: command.requestId,
  });
  if (error) throw mapOperationsRpcError(error);
  return requireObject(data);
}

export async function retireAsset(command: {
  supabase: Rpc;
  organizationId: string;
  assetId: string;
  expectedLockVersion: number;
  input: RetireAssetInput;
  requestId: string;
}): Promise<JsonRecord> {
  const { data, error } = await command.supabase.rpc("retire_asset", {
    target_org: command.organizationId,
    target_asset: command.assetId,
    p_expected_lock_version: command.expectedLockVersion,
    p_reason: command.input.reason ?? null,
    p_occurred_at: command.input.occurredAt ?? null,
    p_request_id: command.requestId,
  });
  if (error) throw mapOperationsRpcError(error);
  return requireObject(data);
}

// Append-only asset service event. Never carries cost — safe for the technician
// history surface.
export async function appendAssetServiceEvent(command: {
  supabase: Rpc;
  organizationId: string;
  assetId: string;
  input: AppendAssetServiceEventInput;
  requestId: string;
}): Promise<JsonRecord> {
  const { input } = command;
  const { data, error } = await command.supabase.rpc("append_asset_service_event", {
    target_org: command.organizationId,
    target_asset: command.assetId,
    p_event_type: input.eventType,
    p_summary: input.summary,
    p_work_order_id: input.workOrderId ?? null,
    p_serviced_at: input.servicedAt ?? null,
    p_occurred_at: input.occurredAt ?? null,
    p_request_id: command.requestId,
  });
  if (error) throw mapOperationsRpcError(error);
  return requireObject(data);
}

export async function getAssetHistory(command: {
  supabase: Rpc;
  organizationId: string;
  assetId: string;
  limit?: number;
}): Promise<JsonRecord> {
  const { data, error } = await command.supabase.rpc("get_pilot_asset_history", {
    target_org: command.organizationId,
    target_asset: command.assetId,
    p_limit: command.limit ?? 50,
  });
  if (error) throw mapOperationsRpcError(error);
  return requireObject(data);
}

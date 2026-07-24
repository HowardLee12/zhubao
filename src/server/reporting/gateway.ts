import { createHash } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";

import { mapOperationsRpcError } from "@/server/api/operations-errors";
import { internalApiProblem } from "@/server/supabase/http";

type Rpc = Pick<SupabaseClient, "rpc">;
type JsonRecord = Record<string, unknown>;

function requireObject(data: unknown): JsonRecord {
  if (!data || typeof data !== "object" || Array.isArray(data)) throw internalApiProblem();
  return data as JsonRecord;
}

async function windowRpc(
  rpcName:
    | "compute_pilot_dashboard"
    | "report_funnel"
    | "report_operations"
    | "report_retention",
  command: { supabase: Rpc; organizationId: string; from?: string; to?: string },
): Promise<JsonRecord> {
  const { data, error } = await command.supabase.rpc(rpcName, {
    target_org: command.organizationId,
    p_from: command.from ?? null,
    p_to: command.to ?? null,
  });
  if (error) throw mapOperationsRpcError(error);
  return requireObject(data);
}

export function computeDashboard(
  command: Parameters<typeof windowRpc>[1],
): Promise<JsonRecord> {
  return windowRpc("compute_pilot_dashboard", command);
}

export function reportFunnel(
  command: Parameters<typeof windowRpc>[1],
): Promise<JsonRecord> {
  return windowRpc("report_funnel", command);
}

export function reportOperations(
  command: Parameters<typeof windowRpc>[1],
): Promise<JsonRecord> {
  return windowRpc("report_operations", command);
}

export function reportRetention(
  command: Parameters<typeof windowRpc>[1],
): Promise<JsonRecord> {
  return windowRpc("report_retention", command);
}

// The owner re-auth material is hashed to a hex digest in Node; the raw token
// never reaches the database. request stores the digest, finalize compares it.
export function hashReauthToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export async function requestDataDeletion(command: {
  supabase: Rpc;
  organizationId: string;
  reauthToken: string;
  occurredAt?: string;
  requestId: string;
}): Promise<JsonRecord> {
  const { data, error } = await command.supabase.rpc("request_pilot_data_deletion", {
    target_org: command.organizationId,
    p_reauth_token_hash_hex: hashReauthToken(command.reauthToken),
    p_occurred_at: command.occurredAt ?? null,
    p_request_id: command.requestId,
  });
  if (error) throw mapOperationsRpcError(error);
  return requireObject(data);
}

export async function finalizeDataDeletion(command: {
  supabase: Rpc;
  organizationId: string;
  deletionRequestId: string;
  reauthToken: string;
  occurredAt?: string;
  requestId: string;
}): Promise<JsonRecord> {
  const { data, error } = await command.supabase.rpc("finalize_pilot_data_deletion", {
    target_org: command.organizationId,
    p_deletion_request_id: command.deletionRequestId,
    p_reauth_token_hash_hex: hashReauthToken(command.reauthToken),
    p_occurred_at: command.occurredAt ?? null,
    p_request_id: command.requestId,
  });
  if (error) throw mapOperationsRpcError(error);
  return requireObject(data);
}

// Worker-only (service_role): purge expired uploads, strip raw webhook payloads,
// clean finalized export artifacts.
export async function runRetentionCleanup(command: {
  supabase: Rpc;
  now?: string;
}): Promise<JsonRecord> {
  const { data, error } = await command.supabase.rpc("run_retention_cleanup", {
    p_now: command.now ?? null,
  });
  if (error) throw mapOperationsRpcError(error);
  return requireObject(data);
}

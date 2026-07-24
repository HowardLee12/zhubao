import { createHash, createHmac, randomUUID } from "node:crypto";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  completePublicIntakePhotoUpload,
  createPublicIntakePhotoUpload,
  resolvePublicIntakeConfig,
  submitPublicServiceRequest,
} from "@/server/public-intake/gateway";

import { execLocalSql, resolveLocalSupabaseEnv } from "./local-supabase-env";

const ALPHA_ORG_ID = "20000000-0000-4000-8000-000000000001";
const BETA_ORG_ID = "20000000-0000-4000-8000-000000000002";
const ALPHA_OWNER_ID = "10000000-0000-4000-8000-000000000001";
const BETA_OWNER_ID = "10000000-0000-4000-8000-000000000005";
const ALPHA_SERVICE_ITEM_ID = "71100000-0000-4000-8000-000000000001";

// A 1x1 PNG whose declared metadata we mirror exactly through the RPCs.
const PNG_BYTES = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);
const PNG_SHA256 = createHash("sha256").update(PNG_BYTES).digest("hex");

const sha256Hex = (value: string) => createHash("sha256").update(value).digest("hex");

const env = resolveLocalSupabaseEnv();

// The gateway reads NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY from
// the environment; point them at the running local stack for this suite.
process.env.NEXT_PUBLIC_SUPABASE_URL = env.apiUrl;
process.env.SUPABASE_SERVICE_ROLE_KEY = env.serviceRoleKey;

const base64Url = (input: Buffer | string) =>
  Buffer.from(input).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

// Mints an authenticated PostgREST JWT signed with the local stack JWT secret so
// inbox RPCs run under the seeded owner's membership. Uses node:crypto directly
// to avoid cross-realm Uint8Array issues under the jsdom test environment.
function mintAuthenticatedJwt(userId: string): string {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const header = base64Url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = base64Url(
    JSON.stringify({
      role: "authenticated",
      sub: userId,
      iat: nowSeconds,
      exp: nowSeconds + 3600,
    }),
  );
  const signature = base64Url(
    createHmac("sha256", env.jwtSecret).update(`${header}.${payload}`).digest(),
  );
  return `${header}.${payload}.${signature}`;
}

function memberClient(jwt: string): SupabaseClient {
  return createClient(env.apiUrl, env.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${jwt}` } },
  });
}

describe("pilot public intake vertical slice (real local Supabase)", () => {
  const rawToken = `intake-${randomUUID()}`;
  const tokenHashHex = sha256Hex(rawToken);
  const intakeId = randomUUID();
  const idempotencyKey = `intake-${randomUUID()}`;
  const clientIpHash = sha256Hex(`203.0.113.${Math.floor(Math.random() * 200) + 1}`);
  // Shared between the ordered create -> complete -> submit -> list steps.
  let createdUploadId = "";
  let submittedReferenceNo = "";

  beforeAll(() => {
    // Seed an active intake capability for the Alpha tenant, mirroring the
    // production create_pilot_organization output (raw token never stored).
    execLocalSql(
      env.dbUrl,
      `insert into public.public_access_tokens
         (organization_id, resource_type, resource_id, token_hash, scopes, created_at, expires_at)
       values
         ('${ALPHA_ORG_ID}', 'intake_form', '${ALPHA_ORG_ID}',
          extensions.digest('${rawToken}', 'sha256'),
          array['intake:create','intake:upload'],
          statement_timestamp(), statement_timestamp() + interval '365 days')`,
    );
  });

  afterAll(() => {
    // Best-effort teardown of this run's unique fixtures. Dependent private
    // upload rows reference the token via FK, so remove them first. Never fail
    // the suite on cleanup — each run uses a fresh unique token/intake id.
    try {
      execLocalSql(
        env.dbUrl,
        `delete from private.pilot_intake_uploads
           where token_id in (
             select id from public.public_access_tokens
             where organization_id = '${ALPHA_ORG_ID}'
               and token_hash = extensions.digest('${rawToken}', 'sha256')
           );
         delete from public.public_access_tokens
           where organization_id = '${ALPHA_ORG_ID}'
             and token_hash = extensions.digest('${rawToken}', 'sha256')`,
      );
    } catch {
      // Leftover fixtures are harmless; the next run seeds a new unique token.
    }
  });

  it("resolves the public config with merchant display copy and service items", async () => {
    const config = await resolvePublicIntakeConfig(tokenHashHex);

    expect(config.merchantName).toBe("Alpha 冷氣水電（測試）");
    expect(config.headline.length).toBeGreaterThan(0);
    expect(config.privacyNotice.length).toBeGreaterThan(0);
    expect(config.photoLimit).toBe(3);
    expect(config.acceptedPhotoTypes).toEqual(["image/jpeg", "image/png", "image/webp"]);
    expect(config.serviceCatalogItems.length).toBeGreaterThan(0);
    // No internal capability data must cross the boundary.
    expect(JSON.stringify(config)).not.toMatch(/token|hash|settings|defaultCost/i);
  });

  it("creates an upload reservation and returns only a signed upload instruction", async () => {
    const instruction = await createPublicIntakePhotoUpload({
      tokenHash: tokenHashHex,
      clientIpHash,
      submissionId: intakeId,
      filename: "現場照片.png",
      contentType: "image/png",
      byteSize: PNG_BYTES.byteLength,
      sha256: PNG_SHA256,
    });

    expect(instruction.photoId).toMatch(/^[0-9a-f-]{36}$/);
    expect(instruction.upload.method).toBe("PUT");
    expect(instruction.upload.url).toContain("http");
    // The gateway must surface only the photo id + storage upload instruction.
    // (The signed upload URL legitimately carries its own short-lived storage
    // token, which is not the DB capability token.)
    expect(Object.keys(instruction).sort()).toEqual(["photoId", "upload"]);
    expect(JSON.stringify(instruction)).not.toContain(tokenHashHex);
    expect(JSON.stringify(instruction)).not.toContain(clientIpHash);
    createdUploadId = instruction.photoId;
  });

  it("completes the upload against real bytes and submits an idempotent request", async () => {
    // Upload the exact declared bytes to the reserved private object, then let
    // the gateway download + verify + finalize them through the RPCs.
    const admin = createClient(env.apiUrl, env.serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const storagePath =
      `org/${ALPHA_ORG_ID}/service-requests/${intakeId}/${createdUploadId}/upload`;
    const uploaded = await admin.storage
      .from("v2-intake-photos")
      .upload(storagePath, PNG_BYTES, { contentType: "image/png", upsert: true });
    expect(uploaded.error).toBeNull();

    const completed = await completePublicIntakePhotoUpload({
      tokenHash: tokenHashHex,
      submissionId: intakeId,
      photoId: createdUploadId,
      idempotencyKey: `complete-${randomUUID()}`,
    });
    expect(completed).toEqual({ photoId: createdUploadId, status: "ready" });

    const receipt = await submitPublicServiceRequest({
      tokenHash: tokenHashHex,
      submissionId: intakeId,
      idempotencyKey,
      clientIpHash,
      requestBody: {
        serviceCatalogItemId: ALPHA_SERVICE_ITEM_ID,
        contactName: "整合測試客戶",
        contactPhone: "+886912345678",
        subject: "整合測試滲水案件",
        description: "整合測試描述",
        address: { county: "台北市", district: "中山區", addressLine: "整合測試路 10 號" },
        preferredWindows: [],
      },
      photoIds: [createdUploadId],
    });

    expect(receipt.referenceNo.length).toBeGreaterThan(0);
    expect(Number.isFinite(Date.parse(receipt.receivedAt))).toBe(true);
    expect(receipt.message.length).toBeGreaterThan(0);
    // serviceRequestId is internal and must not appear in the customer receipt.
    expect(JSON.stringify(receipt)).not.toContain(intakeId);
    submittedReferenceNo = receipt.referenceNo;
  });

  it("replays the same idempotency key to the identical reference number", async () => {
    const replay = await submitPublicServiceRequest({
      tokenHash: tokenHashHex,
      submissionId: intakeId,
      idempotencyKey,
      clientIpHash,
      requestBody: {
        serviceCatalogItemId: ALPHA_SERVICE_ITEM_ID,
        contactName: "整合測試客戶",
        contactPhone: "+886912345678",
        subject: "整合測試滲水案件",
        description: "整合測試描述",
        address: { county: "台北市", district: "中山區", addressLine: "整合測試路 10 號" },
        preferredWindows: [],
      },
      photoIds: [createdUploadId],
    });

    expect(replay.referenceNo).toBe(submittedReferenceNo);
  });

  it("surfaces the submitted request in the owner inbox with contact phone", async () => {
    const client = memberClient(mintAuthenticatedJwt(ALPHA_OWNER_ID));
    const { data, error } = await client.rpc("list_pilot_service_requests", {
      p_organization_id: ALPHA_ORG_ID,
      p_page_size: 100,
    });

    expect(error).toBeNull();
    const row = (data as { items: Array<{ id: string; contactPhone: string; requestNo: string }> })
      .items.find((item) => item.id === intakeId);
    expect(row).toBeDefined();
    expect(row?.requestNo).toBe(submittedReferenceNo);
    expect(row?.contactPhone).toBe("+886912345678");
  });

  it("prevents a different tenant owner from listing the request", async () => {
    const betaClient = memberClient(mintAuthenticatedJwt(BETA_OWNER_ID));

    // Beta owner querying Alpha's inbox must be forbidden.
    const forbidden = await betaClient.rpc("list_pilot_service_requests", {
      p_organization_id: ALPHA_ORG_ID,
      p_page_size: 100,
    });
    expect(forbidden.error).not.toBeNull();

    // Beta owner's own inbox must not contain the Alpha request.
    const own = await betaClient.rpc("list_pilot_service_requests", {
      p_organization_id: BETA_ORG_ID,
      p_page_size: 100,
    });
    expect(own.error).toBeNull();
    const items = (own.data as { items: Array<{ id: string }> }).items;
    expect(items.some((item) => item.id === intakeId)).toBe(false);
  });
});

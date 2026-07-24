import { createHash, createHmac, randomUUID } from "node:crypto";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

import { resolveLocalSupabaseEnv, execLocalSql } from "./local-supabase-env";

vi.setConfig({ testTimeout: 30000 });

const ALPHA_ORG_ID = "20000000-0000-4000-8000-000000000001";
const BETA_ORG_ID = "20000000-0000-4000-8000-000000000002";
const ALPHA_OWNER_ID = "10000000-0000-4000-8000-000000000001";
const ALPHA_DISPATCHER_ID = "10000000-0000-4000-8000-000000000002";
const BETA_OWNER_ID = "10000000-0000-4000-8000-000000000005";
const ALPHA_CUSTOMER_ID = "40000000-0000-4000-8000-000000000001";
const ALPHA_LOCATION_ID = "50000000-0000-4000-8000-000000000001";
const AC_CLEAN_ITEM_ID = "71100000-0000-4000-8000-000000000001";

const env = resolveLocalSupabaseEnv();

const base64Url = (input: Buffer | string) =>
  Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

function mintJwt(userId: string): string {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const header = base64Url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = base64Url(
    JSON.stringify({ role: "authenticated", sub: userId, iat: nowSeconds, exp: nowSeconds + 3600 }),
  );
  const signature = base64Url(
    createHmac("sha256", env.jwtSecret).update(`${header}.${payload}`).digest(),
  );
  return `${header}.${payload}.${signature}`;
}

function memberClient(userId: string): SupabaseClient {
  return createClient(env.apiUrl, env.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${mintJwt(userId)}` } },
  });
}

function serviceClient(): SupabaseClient {
  return createClient(env.apiUrl, env.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function seedTriagedRequest(): string {
  const id = randomUUID();
  const requestNo = `SR-M4-${randomUUID().slice(0, 8)}`;
  execLocalSql(
    env.dbUrl,
    `insert into public.service_requests (
       id, organization_id, request_no, customer_id, location_id, source,
       contact_name, contact_phone, subject, description, status, triaged_at,
       metadata, original_submission
     ) values (
       '${id}', '${ALPHA_ORG_ID}', '${requestNo}', '${ALPHA_CUSTOMER_ID}',
       '${ALPHA_LOCATION_ID}', 'web', '整合客戶', '+886900111222',
       '兩台冷氣清洗', '客廳與主臥各一台', 'triaged', statement_timestamp(),
       jsonb_build_object('serviceCatalogItemId','${AC_CLEAN_ITEM_ID}'),
       jsonb_build_object('subject','兩台冷氣清洗','contactPhone','+886900111222')
     )`,
  );
  return id;
}

function quoteVersionPayload(title = "兩台冷氣清洗報價") {
  return {
    title,
    validUntil: "2026-12-31",
    customerNotes: "現場追加項目會先確認。",
    internalNotes: "內部成本不可提供客戶",
    terms: "完工確認後付款。",
    items: [
      {
        serviceCatalogItemId: AC_CLEAN_ITEM_ID,
        groupName: "冷氣服務",
        name: "分離式冷氣清洗",
        specification: "客廳與主臥各一台",
        unit: "台",
        quantity: "2.000",
        unitCostMinor: "1200",
        unitPriceMinor: "2500",
        discountMinor: "0",
        taxRate: "0.0500",
        sortOrder: 10,
      },
    ],
  };
}

function createQuotePayload(title = "兩台冷氣清洗報價") {
  return {
    customerId: ALPHA_CUSTOMER_ID,
    locationId: ALPHA_LOCATION_ID,
    currency: "TWD",
    ...quoteVersionPayload(title),
  };
}

interface QuoteWorkspaceResult {
  quote: { id: string; status: string; lockVersion: number };
  version: { id: string; versionNo: number; status: string; totalMinor: string; title: string };
  request: { status: string; lockVersion: number };
}

describe("M4 quote vertical slice (real local Supabase)", () => {
  it("runs create -> save -> send -> public view -> no-registration accept -> convert", async () => {
    const requestId = seedTriagedRequest();
    const dispatcher = memberClient(ALPHA_DISPATCHER_ID);
    const owner = memberClient(ALPHA_OWNER_ID);
    const publicGateway = serviceClient();

    const created = await dispatcher.rpc("create_pilot_quote", {
      p_organization_id: ALPHA_ORG_ID,
      p_service_request_id: requestId,
      p_expected_request_lock_version: 1,
      p_payload: createQuotePayload(),
      p_idempotency_key: `create-${randomUUID()}`,
      p_request_id: randomUUID(),
    });
    expect(created.error).toBeNull();
    const first = created.data as QuoteWorkspaceResult;
    expect(first.quote.status).toBe("draft");
    expect(first.version.totalMinor).toBe("5250");
    expect(first.request.status).toBe("quoting");

    const saved = await dispatcher.rpc("save_pilot_quote_draft", {
      p_organization_id: ALPHA_ORG_ID,
      p_version_id: first.version.id,
      p_expected_quote_lock_version: first.quote.lockVersion,
      p_payload: quoteVersionPayload("確認後正式報價"),
      p_request_id: randomUUID(),
    });
    expect(saved.error).toBeNull();
    const draft = saved.data as QuoteWorkspaceResult;
    expect(draft.version.title).toBe("確認後正式報價");
    expect(draft.quote.lockVersion).toBe(2);

    const rawToken = `m4-integration-${randomUUID()}`;
    const tokenHash = createHash("sha256").update(rawToken).digest("hex");
    const sent = await owner.rpc("approve_and_send_pilot_quote", {
      p_organization_id: ALPHA_ORG_ID,
      p_quote_id: draft.quote.id,
      p_version_id: draft.version.id,
      p_expected_quote_lock_version: draft.quote.lockVersion,
      p_expected_request_lock_version: draft.request.lockVersion,
      p_public_token_hash_hex: tokenHash,
      p_idempotency_key: `send-${randomUUID()}`,
      p_request_id: randomUUID(),
    });
    expect(sent.error).toBeNull();
    expect((sent.data as QuoteWorkspaceResult).quote.status).toBe("sent");

    const viewed = await publicGateway.rpc("resolve_pilot_public_quote", {
      p_public_token_hash_hex: tokenHash,
    });
    expect(viewed.error).toBeNull();
    const publicQuote = viewed.data as Record<string, unknown>;
    expect(publicQuote.status).toBe("viewed");
    expect(publicQuote.totalMinor).toBe("5250");
    expect(JSON.stringify(publicQuote)).not.toMatch(
      /unitCost|internalNotes|organizationId|versionId/,
    );

    const accepted = await publicGateway.rpc("respond_pilot_public_quote", {
      p_public_token_hash_hex: tokenHash,
      p_idempotency_key: `response-${randomUUID()}`,
      p_payload: {
        decision: "accept",
        displayName: "整合客戶",
        comment: "請安排週六上午",
      },
      p_request_id: randomUUID(),
    });
    expect(accepted.error).toBeNull();
    expect((accepted.data as { decision: string }).decision).toBe("accept");

    const current = await owner.rpc("get_pilot_quote_workspace", {
      p_organization_id: ALPHA_ORG_ID,
      p_quote_id: draft.quote.id,
    });
    expect(current.error).toBeNull();
    const acceptedWorkspace = current.data as QuoteWorkspaceResult;
    expect(acceptedWorkspace.quote.status).toBe("accepted");

    const converted = await owner.rpc("convert_service_request", {
      target_org: ALPHA_ORG_ID,
      target_request: requestId,
      expected_lock_version: acceptedWorkspace.request.lockVersion,
      p_mode: "singleVisit",
      target_idempotency_key: `convert-${randomUUID()}`,
    });
    expect(converted.error).toBeNull();
    expect((converted.data as { serviceRequest: { status: string } }).serviceRequest.status).toBe(
      "converted",
    );
  });

  it("enforces tenant boundaries and preserves a rejected version when cloning v2", async () => {
    const requestId = seedTriagedRequest();
    const owner = memberClient(ALPHA_OWNER_ID);
    const dispatcher = memberClient(ALPHA_DISPATCHER_ID);
    const betaOwner = memberClient(BETA_OWNER_ID);
    const publicGateway = serviceClient();

    const created = await dispatcher.rpc("create_pilot_quote", {
      p_organization_id: ALPHA_ORG_ID,
      p_service_request_id: requestId,
      p_expected_request_lock_version: 1,
      p_payload: createQuotePayload("拒絕流程報價"),
      p_idempotency_key: `create-${randomUUID()}`,
      p_request_id: randomUUID(),
    });
    expect(created.error).toBeNull();
    const draft = created.data as QuoteWorkspaceResult;

    const forbidden = await betaOwner.rpc("get_pilot_quote_workspace", {
      p_organization_id: ALPHA_ORG_ID,
      p_quote_id: draft.quote.id,
    });
    expect(forbidden.error?.message).toContain("FORBIDDEN");
    const hidden = await betaOwner.rpc("get_pilot_quote_workspace", {
      p_organization_id: BETA_ORG_ID,
      p_quote_id: draft.quote.id,
    });
    expect(hidden.error?.message).toContain("QUOTE_NOT_FOUND");

    const tokenHash = createHash("sha256").update(randomUUID()).digest("hex");
    const sent = await owner.rpc("approve_and_send_pilot_quote", {
      p_organization_id: ALPHA_ORG_ID,
      p_quote_id: draft.quote.id,
      p_version_id: draft.version.id,
      p_expected_quote_lock_version: draft.quote.lockVersion,
      p_expected_request_lock_version: draft.request.lockVersion,
      p_public_token_hash_hex: tokenHash,
      p_idempotency_key: `send-${randomUUID()}`,
      p_request_id: randomUUID(),
    });
    expect(sent.error).toBeNull();

    const rejected = await publicGateway.rpc("respond_pilot_public_quote", {
      p_public_token_hash_hex: tokenHash,
      p_idempotency_key: `response-${randomUUID()}`,
      p_payload: {
        decision: "reject",
        displayName: "整合客戶",
        comment: "預算需要調整",
      },
      p_request_id: randomUUID(),
    });
    expect(rejected.error).toBeNull();

    const rejectedWorkspace = await dispatcher.rpc("get_pilot_quote_workspace", {
      p_organization_id: ALPHA_ORG_ID,
      p_quote_id: draft.quote.id,
    });
    const rejectedResult = rejectedWorkspace.data as QuoteWorkspaceResult;
    expect(rejectedResult.version.status).toBe("rejected");
    expect(rejectedResult.request.status).toBe("quoting");

    const cloned = await dispatcher.rpc("clone_pilot_quote_version", {
      p_organization_id: ALPHA_ORG_ID,
      p_quote_id: draft.quote.id,
      p_clone_from_version_id: draft.version.id,
      p_expected_quote_lock_version: rejectedResult.quote.lockVersion,
      p_idempotency_key: `clone-${randomUUID()}`,
      p_request_id: randomUUID(),
    });
    expect(cloned.error).toBeNull();
    const revised = cloned.data as QuoteWorkspaceResult;
    expect(revised.version.versionNo).toBe(2);
    expect(revised.version.status).toBe("draft");
    expect(revised.version.totalMinor).toBe("5250");
  });
});

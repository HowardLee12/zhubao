import { createHmac, randomUUID } from "node:crypto";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, describe, expect, it, vi } from "vitest";

import { execLocalSql, resolveLocalSupabaseEnv } from "./local-supabase-env";

// Each test seeds fixtures by shelling out to psql; give the real-stack round
// trips generous headroom over the 5s default.
vi.setConfig({ testTimeout: 30000 });

const ALPHA_ORG_ID = "20000000-0000-4000-8000-000000000001";
const BETA_ORG_ID = "20000000-0000-4000-8000-000000000002";
const ALPHA_OWNER_ID = "10000000-0000-4000-8000-000000000001";
const ALPHA_TECH_ID = "10000000-0000-4000-8000-000000000003";
const BETA_OWNER_ID = "10000000-0000-4000-8000-000000000005";
const ALPHA_CUSTOMER_ID = "40000000-0000-4000-8000-000000000001";
const ALPHA_LOCATION_ID = "50000000-0000-4000-8000-000000000001";
const AC_CLEAN_ITEM_ID = "71100000-0000-4000-8000-000000000001";

const env = resolveLocalSupabaseEnv();

const base64Url = (input: Buffer | string) =>
  Buffer.from(input).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

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

// Seeds a fresh service request in `new` status carrying a service catalog item
// (with a checklist template) in metadata, so convert can snapshot a checklist.
function seedServiceRequest(id: string, requestNo: string): void {
  execLocalSql(
    env.dbUrl,
    `insert into public.service_requests (
       id, organization_id, request_no, customer_id, location_id, source,
       contact_name, contact_phone, subject, description, status, metadata, original_submission
     ) values (
       '${id}', '${ALPHA_ORG_ID}', '${requestNo}', '${ALPHA_CUSTOMER_ID}',
       '${ALPHA_LOCATION_ID}', 'web', '整合客戶', '+886900111222',
       '冷氣不冷', '需要清洗', 'new',
       jsonb_build_object('serviceCatalogItemId','${AC_CLEAN_ITEM_ID}'),
       jsonb_build_object('subject','冷氣不冷','contactPhone','+886900111222')
     )`,
  );
}

describe("M3 triage/convert vertical slice (real local Supabase)", () => {
  const seededIds: string[] = [];

  function freshRequest(): { id: string; requestNo: string } {
    const id = randomUUID();
    const requestNo = `SR-M3-${randomUUID().slice(0, 8)}`;
    seedServiceRequest(id, requestNo);
    seededIds.push(id);
    return { id, requestNo };
  }

  afterAll(() => {
    for (const id of seededIds) {
      try {
        execLocalSql(
          env.dbUrl,
          `delete from public.work_order_checklist_items where work_order_id in (
             select id from public.work_orders where service_request_id = '${id}');
           delete from public.work_order_checklists where work_order_id in (
             select id from public.work_orders where service_request_id = '${id}');
           delete from public.work_orders where service_request_id = '${id}';
           delete from public.projects where service_request_id = '${id}';
           delete from public.events where aggregate_id = '${id}';
           delete from public.service_requests where id = '${id}'`,
        );
      } catch {
        // Leftover fixtures are harmless; ids are unique per run.
      }
    }
  });

  it("triages a new request as the owner (new -> triaged)", async () => {
    const { id } = freshRequest();
    const owner = memberClient(ALPHA_OWNER_ID);

    const { data, error } = await owner.rpc("triage_service_request", {
      target_org: ALPHA_ORG_ID,
      target_request: id,
      expected_lock_version: 1,
      p_customer_id: ALPHA_CUSTOMER_ID,
      p_location_id: ALPHA_LOCATION_ID,
      p_priority: "high",
      p_category: "cooling",
    });

    expect(error).toBeNull();
    const row = data as { status: string; lock_version: number; priority: string; category: string };
    expect(row.status).toBe("triaged");
    expect(row.lock_version).toBe(2);
    expect(row.priority).toBe("high");
    expect(row.category).toBe("cooling");
  });

  it("forbids a technician from triaging (42501)", async () => {
    const { id } = freshRequest();
    const tech = memberClient(ALPHA_TECH_ID);

    const { error } = await tech.rpc("triage_service_request", {
      target_org: ALPHA_ORG_ID,
      target_request: id,
      expected_lock_version: 1,
      p_customer_id: ALPHA_CUSTOMER_ID,
    });

    expect(error).not.toBeNull();
    expect(error?.message).toContain("FORBIDDEN");
  });

  it("rejects a stale lock version on triage (STALE_VERSION)", () => {
    const { id } = freshRequest();

    // NOTE: STALE_VERSION is raised with SQLSTATE 40001 (serialization_failure),
    // which PostgREST auto-retries until its 60s upstream timeout — so the stale
    // path is asserted at the DB layer here (fast + deterministic) rather than
    // over HTTP. This 40001 -> 60s-hang behaviour is a pre-existing DB contract
    // (transition_service_request has it too); see the handoff risk note.
    let thrown: unknown;
    try {
      execLocalSql(
        env.dbUrl,
        `do $$
         begin
           perform set_config('request.jwt.claim.sub', '${ALPHA_OWNER_ID}', true);
           perform set_config('role', 'authenticated', true);
           perform public.triage_service_request(
             '${ALPHA_ORG_ID}', '${id}', 99, '${ALPHA_CUSTOMER_ID}'
           );
         end $$;`,
      );
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeTruthy();
    expect(String(thrown)).toContain("STALE_VERSION");
  });

  it("converts a triaged request into a work order with a checklist snapshot", async () => {
    const { id } = freshRequest();
    const owner = memberClient(ALPHA_OWNER_ID);

    await owner.rpc("triage_service_request", {
      target_org: ALPHA_ORG_ID,
      target_request: id,
      expected_lock_version: 1,
      p_customer_id: ALPHA_CUSTOMER_ID,
      p_location_id: ALPHA_LOCATION_ID,
    });

    const { data, error } = await owner.rpc("convert_service_request", {
      target_org: ALPHA_ORG_ID,
      target_request: id,
      expected_lock_version: 2,
      p_mode: "singleVisit",
      target_idempotency_key: `conv-${randomUUID()}`,
    });

    expect(error).toBeNull();
    const envelope = data as {
      serviceRequest: { status: string };
      workOrder: { id: string; workOrderNo: string; title: string };
      project: unknown;
      replayed: boolean;
    };
    expect(envelope.serviceRequest.status).toBe("converted");
    expect(envelope.project).toBeNull();
    expect(envelope.workOrder.workOrderNo).toMatch(/^WO-\d{6}-\d{6}$/);
    // The work order title is snapshotted from the catalog item name.
    expect(envelope.workOrder.title).toBe("分離式冷氣清洗");
    expect(envelope.replayed).toBe(false);

    // A checklist was snapshotted by value from the item's template.
    const admin = createClient(env.apiUrl, env.serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: items } = await admin
      .from("work_order_checklist_items")
      .select("label, work_order_id")
      .eq("work_order_id", envelope.workOrder.id);
    expect((items ?? []).length).toBe(1);
    expect((items as Array<{ label: string }>)[0].label).toBe("確認運轉正常");
  });

  it("replays an already-converted request as the same case (convert-once)", async () => {
    const { id } = freshRequest();
    const owner = memberClient(ALPHA_OWNER_ID);

    await owner.rpc("triage_service_request", {
      target_org: ALPHA_ORG_ID,
      target_request: id,
      expected_lock_version: 1,
      p_customer_id: ALPHA_CUSTOMER_ID,
      p_location_id: ALPHA_LOCATION_ID,
    });
    const first = await owner.rpc("convert_service_request", {
      target_org: ALPHA_ORG_ID,
      target_request: id,
      expected_lock_version: 2,
      p_mode: "singleVisit",
      target_idempotency_key: `conv-${randomUUID()}`,
    });
    const firstWoId = (first.data as { workOrder: { id: string } }).workOrder.id;

    // A second convert (even with a now-stale version) returns the existing case.
    const replay = await owner.rpc("convert_service_request", {
      target_org: ALPHA_ORG_ID,
      target_request: id,
      expected_lock_version: 2,
      p_mode: "singleVisit",
      target_idempotency_key: `conv-${randomUUID()}`,
    });

    expect(replay.error).toBeNull();
    const replayEnvelope = replay.data as { workOrder: { id: string }; replayed: boolean };
    expect(replayEnvelope.replayed).toBe(true);
    expect(replayEnvelope.workOrder.id).toBe(firstWoId);

    // No second work order was created.
    const admin = createClient(env.apiUrl, env.serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: workOrders } = await admin
      .from("work_orders")
      .select("id")
      .eq("service_request_id", id);
    expect((workOrders ?? []).length).toBe(1);
  });

  it("leaves original_submission untouched across a content edit (PATCH path)", async () => {
    const { id } = freshRequest();
    const owner = memberClient(ALPHA_OWNER_ID);

    const before = await owner.rpc("get_pilot_service_request_detail", {
      p_organization_id: ALPHA_ORG_ID,
      p_service_request_id: id,
    });
    expect(before.error).toBeNull();
    const original = (before.data as {
      request: { original_submission: unknown };
    }).request.original_submission;

    const patch = await owner.rpc("update_pilot_service_request_summary", {
      p_organization_id: ALPHA_ORG_ID,
      p_service_request_id: id,
      p_expected_lock_version: 1,
      p_patch: { subject: "冷氣完全不冷" },
      p_request_id: randomUUID(),
    });

    expect(patch.error).toBeNull();
    const workspace = patch.data as {
      request: { subject: string; original_submission: unknown; lock_version: number };
    };
    expect(workspace.request.subject).toBe("冷氣完全不冷");
    expect(workspace.request.lock_version).toBe(2);
    expect(workspace.request.original_submission).toEqual(original);

    const timeline = await owner.rpc("list_pilot_service_request_events", {
      p_organization_id: ALPHA_ORG_ID,
      p_service_request_id: id,
      p_limit: 20,
    });
    expect(timeline.error).toBeNull();
    expect(
      (timeline.data as Array<{ event_type: string }>).some(
        (event) => event.event_type === "service_request.summary_updated",
      ),
    ).toBe(true);
  });

  it("rejects any mutation of original_submission (ORIGINAL_SUBMISSION_IMMUTABLE)", async () => {
    const { id } = freshRequest();
    // Even a service-role client cannot rewrite the immutable snapshot: the guard
    // trigger fires for all roles.
    const admin = createClient(env.apiUrl, env.serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { error } = await admin
      .from("service_requests")
      .update({ original_submission: { tampered: true }, lock_version: 2 })
      .eq("organization_id", ALPHA_ORG_ID)
      .eq("id", id)
      .eq("lock_version", 1);

    expect(error).not.toBeNull();
    expect(error?.message).toContain("ORIGINAL_SUBMISSION_IMMUTABLE");
  });

  it("does not leak a request across tenants (cross-tenant read returns nothing)", async () => {
    const { id } = freshRequest();
    const beta = memberClient(BETA_OWNER_ID);

    // The staff projection RPC rejects another organization's context, and an
    // Alpha request id queried under Beta's valid context is indistinguishable
    // from a missing resource.
    const forbiddenRead = await beta.rpc("get_pilot_service_request_detail", {
      p_organization_id: ALPHA_ORG_ID,
      p_service_request_id: id,
    });
    expect(forbiddenRead.error?.message).toContain("FORBIDDEN");

    const nonLeakyRead = await beta.rpc("get_pilot_service_request_detail", {
      p_organization_id: BETA_ORG_ID,
      p_service_request_id: id,
    });
    expect(nonLeakyRead.error?.message).toContain("SERVICE_REQUEST_NOT_FOUND");

    // Beta owner triaging Alpha's request is forbidden.
    const { error } = await beta.rpc("triage_service_request", {
      target_org: BETA_ORG_ID,
      target_request: id,
      expected_lock_version: 1,
      p_customer_id: ALPHA_CUSTOMER_ID,
    });
    expect(error).not.toBeNull();
  });

  it("finds a similar customer by phone within the tenant, not across tenants", async () => {
    const owner = memberClient(ALPHA_OWNER_ID);
    // Seed a customer with a known phone in Alpha.
    const phone = "+8869" + String(Math.floor(Math.random() * 90000000) + 10000000);
    const customerId = randomUUID();
    execLocalSql(
      env.dbUrl,
      `insert into public.customers (id, organization_id, customer_no, kind, name, phone, source)
       values ('${customerId}', '${ALPHA_ORG_ID}', 'C-M3-${customerId.slice(0, 6)}', 'individual', '相似客戶', '${phone}', 'manual')`,
    );

    try {
      const { data, error } = await owner.rpc("find_similar_customers", {
        target_org: ALPHA_ORG_ID,
        p_phone: phone,
        p_limit: 5,
      });
      expect(error).toBeNull();
      const rows = data as Array<{ customer_id: string; match_reason: string }>;
      expect(rows.some((r) => r.customer_id === customerId && r.match_reason === "phone")).toBe(
        true,
      );

      // Beta owner must not see the Alpha customer.
      const beta = memberClient(BETA_OWNER_ID);
      const betaResult = await beta.rpc("find_similar_customers", {
        target_org: BETA_ORG_ID,
        p_phone: phone,
        p_limit: 5,
      });
      expect(betaResult.error).toBeNull();
      expect((betaResult.data as Array<{ customer_id: string }>).some((r) => r.customer_id === customerId)).toBe(
        false,
      );
    } finally {
      execLocalSql(env.dbUrl, `delete from public.customers where id = '${customerId}'`);
    }
  });

  it("returns a keyset page and pages without gaps via list_pilot_service_requests", async () => {
    const owner = memberClient(ALPHA_OWNER_ID);
    // Ensure at least a couple of Alpha requests exist (the seeded ones from
    // freshRequest above plus the base seed) and page size 1 to force a cursor.
    freshRequest();
    freshRequest();

    const firstPage = await owner.rpc("list_pilot_service_requests", {
      p_organization_id: ALPHA_ORG_ID,
      p_limit: 1,
    });
    expect(firstPage.error).toBeNull();
    const firstItems = (firstPage.data as { items: Array<{ id: string; createdAt: string }> }).items;
    expect(firstItems.length).toBe(1);

    const secondPage = await owner.rpc("list_pilot_service_requests", {
      p_organization_id: ALPHA_ORG_ID,
      p_limit: 1,
      p_after_created_at: firstItems[0].createdAt,
      p_after_id: firstItems[0].id,
    });
    expect(secondPage.error).toBeNull();
    const secondItems = (secondPage.data as { items: Array<{ id: string }> }).items;
    // The keyset advances: the second page does not repeat the first item.
    expect(secondItems.some((item) => item.id === firstItems[0].id)).toBe(false);
  });

  it("rejects a keyset call with only one of the cursor fields (PILOT_VALIDATION_FAILED)", async () => {
    const owner = memberClient(ALPHA_OWNER_ID);
    const { error } = await owner.rpc("list_pilot_service_requests", {
      p_organization_id: ALPHA_ORG_ID,
      p_limit: 10,
      p_after_created_at: "2026-07-16T10:00:00.000Z",
    });
    expect(error).not.toBeNull();
    expect(error?.message).toContain("PILOT_VALIDATION_FAILED");
  });
});

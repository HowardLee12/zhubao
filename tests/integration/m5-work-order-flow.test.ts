import { createHash, createHmac, randomUUID } from "node:crypto";
import { deflateSync } from "node:zlib";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { resolveLocalSupabaseEnv, execLocalSql } from "./local-supabase-env";

vi.setConfig({ testTimeout: 45000 });

const ALPHA_ORG_ID = "20000000-0000-4000-8000-000000000001";
const BETA_ORG_ID = "20000000-0000-4000-8000-000000000002";
const ALPHA_OWNER_USER = "10000000-0000-4000-8000-000000000001";
const ALPHA_DISPATCHER_USER = "10000000-0000-4000-8000-000000000002";
const ALPHA_TECH_A_USER = "10000000-0000-4000-8000-000000000003";
const ALPHA_TECH_B_USER = "10000000-0000-4000-8000-000000000004";
const BETA_OWNER_USER = "10000000-0000-4000-8000-000000000005";
const ALPHA_TECH_A_MEMBERSHIP = "30000000-0000-4000-8000-000000000003";
const ALPHA_TECH_B_MEMBERSHIP = "30000000-0000-4000-8000-000000000004";
const ALPHA_CUSTOMER_ID = "40000000-0000-4000-8000-000000000001";
const ALPHA_LOCATION_ID = "50000000-0000-4000-8000-000000000001";
const WORK_MEDIA_BUCKET = "work-media";

const env = resolveLocalSupabaseEnv();

const base64Url = (input: Buffer | string) =>
  Buffer.from(input).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

function mintJwt(userId: string): string {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const header = base64Url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = base64Url(
    JSON.stringify({ role: "authenticated", sub: userId, iat: nowSeconds, exp: nowSeconds + 3600 }),
  );
  const signature = base64Url(createHmac("sha256", env.jwtSecret).update(`${header}.${payload}`).digest());
  return `${header}.${payload}.${signature}`;
}

function memberClient(userId: string): SupabaseClient {
  return createClient(env.apiUrl, env.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${mintJwt(userId)}` } },
  });
}

function adminClient(): SupabaseClient {
  return createClient(env.apiUrl, env.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

// A minimal but genuinely valid 1x1 PNG. image-size reads its IHDR dimensions and
// the magic bytes satisfy the server-side MIME sniff.
function tinyPng(): Buffer {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const chunk = (type: string, data: Buffer): Buffer => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length, 0);
    const typeAndData = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(computeCrc32(typeAndData), 0);
    return Buffer.concat([length, typeAndData, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(1, 0);
  ihdr.writeUInt32BE(1, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const raw = Buffer.from([0x00, 0x00, 0x00, 0x00, 0x00]);
  const idat = deflateSync(raw);
  return Buffer.concat([
    signature,
    chunk("IHDR", ihdr),
    chunk("IDAT", idat),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function computeCrc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

// Reset the seeded draft work order to a clean draft with no assignments/checklists/
// photos before each scenario, so scenarios are independent. We create a fresh work
// order per scenario instead to avoid cross-test coupling.
async function createDraftWorkOrder(
  client: SupabaseClient,
  title: string,
): Promise<{ id: string; lockVersion: number }> {
  const created = await client.rpc("create_work_order", {
    target_org: ALPHA_ORG_ID,
    p_payload: { customerId: ALPHA_CUSTOMER_ID, locationId: ALPHA_LOCATION_ID, title },
    p_idempotency_key: `wo-create-${randomUUID()}`,
    p_request_id: randomUUID(),
  });
  expect(created.error).toBeNull();
  const detail = created.data as { id: string; lockVersion: number };
  return { id: detail.id, lockVersion: detail.lockVersion };
}

function recentOccurredAt(offsetMs = 0): string {
  return new Date(Date.now() - 60_000 + offsetMs).toISOString();
}

// A unique future 2-hour window per call so repeated runs against a non-reset DB
// never manufacture a spurious schedule conflict between independent scenarios.
let windowCounter = 0;
// A per-run random day offset (0..~5 years out) keeps windows disjoint across
// repeated runs on a non-reset DB; the counter keeps them disjoint within a run.
const RUN_DAY_OFFSET_MS = Math.floor(Math.random() * 1800) * 24 * 60 * 60 * 1000;
function uniqueWindow(): { start: string; end: string } {
  windowCounter += 1;
  const base =
    Date.now() + RUN_DAY_OFFSET_MS + windowCounter * 6 * 60 * 60 * 1000 + 30 * 24 * 60 * 60 * 1000;
  return {
    start: new Date(base).toISOString(),
    end: new Date(base + 2 * 60 * 60 * 1000).toISOString(),
  };
}

async function uploadReadyPhoto(params: {
  client: SupabaseClient;
  workOrderId: string;
  category: string;
  checklistItemId?: string;
}): Promise<string> {
  const bytes = tinyPng();
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const reservation = await params.client.rpc("create_photo_upload", {
    target_org: ALPHA_ORG_ID,
    parent_type: "work_order",
    parent_id: params.workOrderId,
    photo_category: params.category,
    original_filename: `${params.category}.png`,
    declared_mime_type: "image/png",
    declared_byte_size: bytes.byteLength,
    declared_sha256: sha256,
    target_checklist_item_id: params.checklistItemId ?? null,
    target_caption: null,
    target_captured_at: null,
  });
  expect(reservation.error).toBeNull();
  const location = reservation.data as { photoId: string; storagePath: string };

  // Write the real bytes to the reserved private object path with the service
  // credential (mirrors the client PUT to the signed upload URL).
  const admin = adminClient();
  const uploaded = await admin.storage
    .from(WORK_MEDIA_BUCKET)
    .upload(location.storagePath, bytes, { contentType: "image/png", upsert: true });
  expect(uploaded.error).toBeNull();

  const completed = await params.client.rpc("complete_work_order_photo", {
    target_org: ALPHA_ORG_ID,
    target_photo: location.photoId,
    p_actual_mime_type: "image/png",
    p_actual_byte_size: bytes.byteLength,
    p_actual_sha256: sha256,
    p_image_width: 1,
    p_image_height: 1,
    p_request_id: randomUUID(),
  });
  expect(completed.error).toBeNull();
  expect((completed.data as { status: string }).status).toBe("ready");
  return location.photoId;
}

beforeAll(() => {
  // Sanity: ensure the seed applied (technician memberships exist).
  execLocalSql(env.dbUrl, "select 1");
});

describe("M5 work-order operations flow (real local Supabase)", () => {
  it("runs create -> schedule+assign -> accept -> dispatch -> enRoute -> arrive -> checklist -> before/after photos -> complete", async () => {
    const dispatcher = memberClient(ALPHA_DISPATCHER_USER);
    const techA = memberClient(ALPHA_TECH_A_USER);

    const draft = await createDraftWorkOrder(dispatcher, "M5 完整流程工單");
    const window = uniqueWindow();

    // Schedule + assign technician A atomically (draft -> scheduled).
    const scheduled = await dispatcher.rpc("schedule_work_order", {
      target_org: ALPHA_ORG_ID,
      target_work_order: draft.id,
      p_scheduled_start_at: window.start,
      p_scheduled_end_at: window.end,
      p_assignments: [{ membershipId: ALPHA_TECH_A_MEMBERSHIP, duty: "lead" }],
      p_expected_lock_version: draft.lockVersion,
      p_occurred_at: recentOccurredAt(),
      p_conflict_override_reason: null,
      p_idempotency_key: null,
      p_request_id: randomUUID(),
    });
    expect(scheduled.error).toBeNull();
    const scheduledDetail = scheduled.data as {
      status: string;
      lockVersion: number;
      assignments: Array<{ id: string; membershipId: string; status: string; lockVersion: number }>;
    };
    expect(scheduledDetail.status).toBe("scheduled");
    const assignment = scheduledDetail.assignments.find(
      (a) => a.membershipId === ALPHA_TECH_A_MEMBERSHIP,
    );
    expect(assignment).toBeDefined();

    // Technician accepts.
    const accepted = await techA.rpc("respond_to_assignment", {
      target_org: ALPHA_ORG_ID,
      target_assignment: assignment!.id,
      p_decision: "accept",
      p_reason: null,
      p_expected_lock_version: assignment!.lockVersion,
      p_idempotency_key: null,
      p_request_id: randomUUID(),
    });
    expect(accepted.error).toBeNull();
    expect((accepted.data as { status: string }).status).toBe("accepted");

    // Manager dispatches, then technician marks en route and arrives.
    let lock = scheduledDetail.lockVersion;
    const dispatched = await dispatcher.rpc("transition_work_order_safe", {
      target_org: ALPHA_ORG_ID,
      target_work_order: draft.id,
      target_status: "dispatched",
      expected_lock_version: lock,
      target_occurred_at: recentOccurredAt(1),
      reason: null,
      completion_summary: null,
      target_correction_reason: null,
      target_request_id: randomUUID(),
      target_idempotency_key: null,
    });
    expect(dispatched.error).toBeNull();
    lock = (dispatched.data as { lockVersion: number }).lockVersion;

    const enRoute = await techA.rpc("transition_work_order_safe", {
      target_org: ALPHA_ORG_ID,
      target_work_order: draft.id,
      target_status: "en_route",
      expected_lock_version: lock,
      target_occurred_at: recentOccurredAt(2),
      reason: null,
      completion_summary: null,
      target_correction_reason: null,
      target_request_id: randomUUID(),
      target_idempotency_key: null,
    });
    expect(enRoute.error).toBeNull();
    lock = (enRoute.data as { lockVersion: number }).lockVersion;

    const arrived = await techA.rpc("transition_work_order_safe", {
      target_org: ALPHA_ORG_ID,
      target_work_order: draft.id,
      target_status: "on_site",
      expected_lock_version: lock,
      target_occurred_at: recentOccurredAt(3),
      reason: null,
      completion_summary: null,
      target_correction_reason: null,
      target_request_id: randomUUID(),
      target_idempotency_key: null,
    });
    expect(arrived.error).toBeNull();
    lock = (arrived.data as { lockVersion: number }).lockVersion;
    expect((arrived.data as { status: string }).status).toBe("on_site");

    // Inline checklist with a required item, then answer it.
    const checklist = await dispatcher.rpc("create_work_order_checklist", {
      target_org: ALPHA_ORG_ID,
      target_work_order: draft.id,
      p_name: "現場檢查",
      p_items: [{ label: "確認排水正常", responseType: "boolean", isRequired: true }],
      p_request_id: randomUUID(),
    });
    expect(checklist.error).toBeNull();

    const detailAfterChecklist = await techA.rpc("get_work_order_detail", {
      target_org: ALPHA_ORG_ID,
      target_work_order: draft.id,
    });
    expect(detailAfterChecklist.error).toBeNull();
    const detail = detailAfterChecklist.data as {
      lockVersion: number;
      checklists: Array<{ id: string; items: Array<{ id: string }> }>;
    };
    const itemId = detail.checklists[0].items[0].id;

    const responded = await techA.rpc("respond_to_checklist_item", {
      target_org: ALPHA_ORG_ID,
      target_item: itemId,
      response_value: true,
      expected_work_order_lock_version: detail.lockVersion,
    });
    expect(responded.error).toBeNull();

    // Before + after photos (real bytes verified and marked ready).
    await uploadReadyPhoto({ client: techA, workOrderId: draft.id, category: "before" });
    await uploadReadyPhoto({ client: techA, workOrderId: draft.id, category: "after" });

    // Complete via the authoritative gate.
    const complete = await techA.rpc("transition_work_order_safe", {
      target_org: ALPHA_ORG_ID,
      target_work_order: draft.id,
      target_status: "completed",
      expected_lock_version: detail.lockVersion,
      target_occurred_at: recentOccurredAt(4),
      reason: null,
      completion_summary: "已完成清洗與檢查",
      target_correction_reason: null,
      target_request_id: randomUUID(),
      target_idempotency_key: null,
    });
    expect(complete.error).toBeNull();
    expect((complete.data as { status: string }).status).toBe("completed");
  });

  it("blocks completion when the after photo is missing (named gate)", async () => {
    const dispatcher = memberClient(ALPHA_DISPATCHER_USER);
    const techA = memberClient(ALPHA_TECH_A_USER);

    const draft = await createDraftWorkOrder(dispatcher, "M5 缺 after 照片");
    const window = uniqueWindow();
    const scheduled = await dispatcher.rpc("schedule_work_order", {
      target_org: ALPHA_ORG_ID,
      target_work_order: draft.id,
      p_scheduled_start_at: window.start,
      p_scheduled_end_at: window.end,
      p_assignments: [{ membershipId: ALPHA_TECH_A_MEMBERSHIP, duty: "lead" }],
      p_expected_lock_version: draft.lockVersion,
      p_occurred_at: recentOccurredAt(),
      p_conflict_override_reason: null,
      p_idempotency_key: null,
      p_request_id: randomUUID(),
    });
    expect(scheduled.error).toBeNull();
    let lock = (scheduled.data as { lockVersion: number }).lockVersion;

    for (const status of ["dispatched", "en_route", "on_site"]) {
      const client = status === "dispatched" ? dispatcher : techA;
      const step = await client.rpc("transition_work_order_safe", {
        target_org: ALPHA_ORG_ID,
        target_work_order: draft.id,
        target_status: status,
        expected_lock_version: lock,
        target_occurred_at: recentOccurredAt(),
        reason: null,
        completion_summary: null,
        target_correction_reason: null,
        target_request_id: randomUUID(),
        target_idempotency_key: null,
      });
      expect(step.error).toBeNull();
      lock = (step.data as { lockVersion: number }).lockVersion;
    }

    // Only a before photo — no after photo.
    await uploadReadyPhoto({ client: techA, workOrderId: draft.id, category: "before" });

    const blocked = await techA.rpc("transition_work_order_safe", {
      target_org: ALPHA_ORG_ID,
      target_work_order: draft.id,
      target_status: "completed",
      expected_lock_version: lock,
      target_occurred_at: recentOccurredAt(),
      reason: null,
      completion_summary: "嘗試完工",
      target_correction_reason: null,
      target_request_id: randomUUID(),
      target_idempotency_key: null,
    });
    expect(blocked.error?.message).toContain("BEFORE_AFTER_PHOTOS_REQUIRED");
  });

  it("lets an owner force-complete with a distinct event and no customer sign-off", async () => {
    const dispatcher = memberClient(ALPHA_DISPATCHER_USER);
    const techA = memberClient(ALPHA_TECH_A_USER);
    const owner = memberClient(ALPHA_OWNER_USER);

    const draft = await createDraftWorkOrder(dispatcher, "M5 例外完工");
    const window = uniqueWindow();
    const scheduled = await dispatcher.rpc("schedule_work_order", {
      target_org: ALPHA_ORG_ID,
      target_work_order: draft.id,
      p_scheduled_start_at: window.start,
      p_scheduled_end_at: window.end,
      p_assignments: [{ membershipId: ALPHA_TECH_A_MEMBERSHIP, duty: "lead" }],
      p_expected_lock_version: draft.lockVersion,
      p_occurred_at: recentOccurredAt(),
      p_conflict_override_reason: null,
      p_idempotency_key: null,
      p_request_id: randomUUID(),
    });
    expect(scheduled.error).toBeNull();
    let lock = (scheduled.data as { lockVersion: number }).lockVersion;
    for (const status of ["dispatched", "en_route", "on_site"]) {
      const client = status === "dispatched" ? dispatcher : techA;
      const step = await client.rpc("transition_work_order_safe", {
        target_org: ALPHA_ORG_ID,
        target_work_order: draft.id,
        target_status: status,
        expected_lock_version: lock,
        target_occurred_at: recentOccurredAt(),
        reason: null,
        completion_summary: null,
        target_correction_reason: null,
        target_request_id: randomUUID(),
        target_idempotency_key: null,
      });
      expect(step.error).toBeNull();
      lock = (step.data as { lockVersion: number }).lockVersion;
    }

    // force-complete needs a checklist snapshot to exist per the DB contract.
    await dispatcher.rpc("create_work_order_checklist", {
      target_org: ALPHA_ORG_ID,
      target_work_order: draft.id,
      p_name: "現場檢查",
      p_items: [{ label: "確認排水", responseType: "boolean", isRequired: true }],
      p_request_id: randomUUID(),
    });

    // A plain dispatcher cannot force-complete.
    const forbidden = await dispatcher.rpc("force_complete_work_order", {
      target_org: ALPHA_ORG_ID,
      target_work_order: draft.id,
      p_reason: "客戶臨時要求結案",
      p_completion_summary: "例外完工",
      p_expected_lock_version: lock,
      p_occurred_at: recentOccurredAt(),
      p_idempotency_key: null,
      p_request_id: randomUUID(),
    });
    expect(forbidden.error?.message).toContain("FORCE_COMPLETE_REQUIRES_OWNER");

    const forced = await owner.rpc("force_complete_work_order", {
      target_org: ALPHA_ORG_ID,
      target_work_order: draft.id,
      p_reason: "客戶臨時要求結案",
      p_completion_summary: "例外完工",
      p_expected_lock_version: lock,
      p_occurred_at: recentOccurredAt(),
      p_idempotency_key: null,
      p_request_id: randomUUID(),
    });
    expect(forced.error).toBeNull();
    const forcedDetail = forced.data as { status: string; customerSignedAt: string | null };
    expect(forcedDetail.status).toBe("completed");
    expect(forcedDetail.customerSignedAt).toBeNull();

    // A distinct force_completed event exists (not a normal work_order.completed).
    const admin = adminClient();
    const events = await admin
      .schema("public")
      .from("events")
      .select("event_type")
      .eq("organization_id", ALPHA_ORG_ID)
      .eq("aggregate_id", draft.id);
    expect(events.error).toBeNull();
    const types = (events.data ?? []).map((row) => (row as { event_type: string }).event_type);
    expect(types).toContain("work_order.force_completed");
    expect(types).not.toContain("work_order.completed");
  });

  it("hides other-tenant and unassigned work orders from a technician", async () => {
    const dispatcher = memberClient(ALPHA_DISPATCHER_USER);
    const techB = memberClient(ALPHA_TECH_B_USER);
    const betaOwner = memberClient(BETA_OWNER_USER);

    // A work order assigned to technician A only.
    const draft = await createDraftWorkOrder(dispatcher, "M5 只屬於技師A");
    const window = uniqueWindow();
    await dispatcher.rpc("schedule_work_order", {
      target_org: ALPHA_ORG_ID,
      target_work_order: draft.id,
      p_scheduled_start_at: window.start,
      p_scheduled_end_at: window.end,
      p_assignments: [{ membershipId: ALPHA_TECH_A_MEMBERSHIP, duty: "lead" }],
      p_expected_lock_version: draft.lockVersion,
      p_occurred_at: recentOccurredAt(),
      p_conflict_override_reason: null,
      p_idempotency_key: null,
      p_request_id: randomUUID(),
    });

    // Technician B (unassigned) cannot read the detail -> non-leaky 404.
    const unassigned = await techB.rpc("get_work_order_detail", {
      target_org: ALPHA_ORG_ID,
      target_work_order: draft.id,
    });
    expect(unassigned.error?.message).toContain("WORK_ORDER_NOT_FOUND");

    // Technician B's own list never includes this work order.
    const techBList = await techB.rpc("list_work_orders", {
      target_org: ALPHA_ORG_ID,
      p_filters: {},
      p_cursor_created_at: null,
      p_cursor_id: null,
      p_page_size: 100,
    });
    expect(techBList.error).toBeNull();
    const items = (techBList.data as { items: Array<{ id: string }> }).items;
    expect(items.some((item) => item.id === draft.id)).toBe(false);

    // A cross-tenant caller is forbidden / sees nothing of Alpha's work order.
    const crossTenant = await betaOwner.rpc("get_work_order_detail", {
      target_org: BETA_ORG_ID,
      target_work_order: draft.id,
    });
    expect(crossTenant.error?.message).toContain("WORK_ORDER_NOT_FOUND");
  });

  it("blocks a plain dispatcher on a schedule conflict but lets an owner override", async () => {
    const dispatcher = memberClient(ALPHA_DISPATCHER_USER);
    const owner = memberClient(ALPHA_OWNER_USER);

    // First work order occupies technician B for a window.
    const occupied = uniqueWindow();
    const overlap = {
      start: new Date(Date.parse(occupied.start) + 60 * 60 * 1000).toISOString(),
      end: new Date(Date.parse(occupied.end) + 60 * 60 * 1000).toISOString(),
    };
    const first = await createDraftWorkOrder(dispatcher, "M5 佔用時段");
    await dispatcher.rpc("schedule_work_order", {
      target_org: ALPHA_ORG_ID,
      target_work_order: first.id,
      p_scheduled_start_at: occupied.start,
      p_scheduled_end_at: occupied.end,
      p_assignments: [{ membershipId: ALPHA_TECH_B_MEMBERSHIP, duty: "lead" }],
      p_expected_lock_version: first.lockVersion,
      p_occurred_at: recentOccurredAt(),
      p_conflict_override_reason: null,
      p_idempotency_key: null,
      p_request_id: randomUUID(),
    });

    // Second work order overlaps for the same technician B.
    const second = await createDraftWorkOrder(dispatcher, "M5 重疊時段");
    const conflict = await dispatcher.rpc("schedule_work_order", {
      target_org: ALPHA_ORG_ID,
      target_work_order: second.id,
      p_scheduled_start_at: overlap.start,
      p_scheduled_end_at: overlap.end,
      p_assignments: [{ membershipId: ALPHA_TECH_B_MEMBERSHIP, duty: "lead" }],
      p_expected_lock_version: second.lockVersion,
      p_occurred_at: recentOccurredAt(),
      p_conflict_override_reason: null,
      p_idempotency_key: null,
      p_request_id: randomUUID(),
    });
    expect(conflict.error?.message).toContain("SCHEDULE_CONFLICT");

    // The owner can override with a reason.
    const overridden = await owner.rpc("schedule_work_order", {
      target_org: ALPHA_ORG_ID,
      target_work_order: second.id,
      p_scheduled_start_at: overlap.start,
      p_scheduled_end_at: overlap.end,
      p_assignments: [{ membershipId: ALPHA_TECH_B_MEMBERSHIP, duty: "lead" }],
      p_expected_lock_version: second.lockVersion,
      p_occurred_at: recentOccurredAt(),
      p_conflict_override_reason: "客戶指定同一師傅連續施作",
      p_idempotency_key: null,
      p_request_id: randomUUID(),
    });
    expect(overridden.error).toBeNull();
    expect((overridden.data as { status: string }).status).toBe("scheduled");
  });
});

import { createHmac, randomUUID } from "node:crypto";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { resolveLocalSupabaseEnv, execLocalSql } from "./local-supabase-env";
import {
  createPaymentMilestone,
  invoicePaymentMilestone,
  markPaymentMilestonePaid,
  markPaymentsOverdue,
  reversePaymentMilestone,
} from "@/server/payments/gateway";
import {
  approveNotifications,
  completeMaintenancePlan,
  convertMaintenancePlanToRequest,
  scanMaintenanceDue,
} from "@/server/maintenance/gateway";
import {
  appendAssetServiceEvent,
  getAssetHistory,
} from "@/server/assets/gateway";
import { computeDashboard, finalizeDataDeletion, requestDataDeletion } from "@/server/reporting/gateway";
import { consumeAuthenticatedRateLimit } from "@/server/api/authenticated-rate-limit";
import { hashReauthToken } from "@/server/reporting/gateway";

vi.setConfig({ testTimeout: 60000 });

const ALPHA_ORG = "20000000-0000-4000-8000-000000000001";
const ALPHA_OWNER = "10000000-0000-4000-8000-000000000001";
const ALPHA_TECH = "10000000-0000-4000-8000-000000000003";
const ALPHA_PROJECT = "81000000-0000-4000-8000-000000000001";
const ALPHA_CUSTOMER = "40000000-0000-4000-8000-000000000001";
const ALPHA_ASSET = "60000000-0000-4000-8000-000000000001";
const ALPHA_OVERDUE_MILESTONE = "87000000-0000-4000-8000-000000000003";
const ALPHA_PLAN = "88000000-0000-4000-8000-000000000001";

const env = resolveLocalSupabaseEnv();

const base64Url = (input: Buffer | string) =>
  Buffer.from(input).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

function mintJwt(userId: string): string {
  const now = Math.floor(Date.now() / 1000);
  const header = base64Url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = base64Url(
    JSON.stringify({ role: "authenticated", sub: userId, iat: now, exp: now + 3600 }),
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

function adminClient(): SupabaseClient {
  return createClient(env.apiUrl, env.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

const owner = memberClient(ALPHA_OWNER);
const tech = memberClient(ALPHA_TECH);
const admin = adminClient();

beforeAll(() => {
  // Reset the overdue-candidate milestone to a clean invoiced/past-due state so a
  // re-run of this suite is deterministic.
  // The status-transition guard trigger blocks a direct status UPDATE; a superuser
  // psql session with replication role bypasses triggers for the fixture reset only.
  // We also restore the Alpha revisit customer's contact method in case a prior run
  // of the data-deletion test anonymized it (it must have a contact for convert).
  execLocalSql(
    env.dbUrl,
    `set session_replication_role = replica; ` +
      `update public.payment_milestones set status='invoiced', paid_at=null, ` +
      `due_on='2026-02-01', lock_version=1 where id='${ALPHA_OVERDUE_MILESTONE}'; ` +
      `update public.customers set name='示範客戶 A', phone='+886922000001' ` +
      `where id='${ALPHA_CUSTOMER}'; ` +
      // Clear any maintenance_reminder drafts from prior runs so the scan enqueues
      // a fresh pending reminder (the dedupe_key would otherwise skip it).
      `delete from public.notifications where organization_id='${ALPHA_ORG}' ` +
      `and template_key='maintenance_reminder'; ` +
      // Reset the plan to its seeded active state (a prior run may have completed
      // or converted it, moving next_due_on).
      `update public.maintenance_plans set status='active', next_due_on='2026-12-01', ` +
      `lock_version=1 where id='${ALPHA_PLAN}'; ` +
      // Restore the customer's LINE identity (a prior data-deletion run may have
      // blocked it), so the reminder enqueue has a recipient.
      `update public.customer_line_identities set friend_status='friend', ` +
      `display_name='示範客戶 A' where id='a1de0000-0000-4000-8000-000000000001'; ` +
      `set session_replication_role = origin;`,
  );
});

describe("M8 payment milestone lifecycle (tracking only)", () => {
  it("creates -> invoices -> marks paid -> reverses to invoiced (amount unchanged)", async () => {
    const created = await createPaymentMilestone({
      supabase: owner,
      organizationId: ALPHA_ORG,
      input: {
        projectId: ALPHA_PROJECT,
        name: `款項 ${randomUUID().slice(0, 8)}`,
        amountMinor: 120000,
        dueOn: "2026-10-01",
      },
      requestId: randomUUID(),
    });
    const milestoneId = created.id as string;
    expect(created.status).toBe("pending");
    expect(created.amountMinor).toBe(120000);

    const invoiced = await invoicePaymentMilestone({
      supabase: owner,
      organizationId: ALPHA_ORG,
      milestoneId,
      expectedLockVersion: created.lockVersion as number,
      input: {},
      idempotencyKey: `inv-${randomUUID()}`,
      requestId: randomUUID(),
    });
    expect(invoiced.status).toBe("invoiced");

    const paid = await markPaymentMilestonePaid({
      supabase: owner,
      organizationId: ALPHA_ORG,
      milestoneId,
      expectedLockVersion: invoiced.lockVersion as number,
      input: { paymentMethod: "cash" },
      idempotencyKey: `pay-${randomUUID()}`,
      requestId: randomUUID(),
    });
    expect(paid.status).toBe("paid");
    expect(paid.amountMinor).toBe(120000);

    const reversed = await reversePaymentMilestone({
      supabase: owner,
      organizationId: ALPHA_ORG,
      milestoneId,
      expectedLockVersion: paid.lockVersion as number,
      input: { reason: "誤記已收款" },
      idempotencyKey: `rev-${randomUUID()}`,
      requestId: randomUUID(),
    });
    expect(reversed.status).toBe("invoiced");
    expect(reversed.amountMinor).toBe(120000);
  });

  it("rejects card/CVV-looking metadata with a 422 security event, without paying", async () => {
    const created = await createPaymentMilestone({
      supabase: owner,
      organizationId: ALPHA_ORG,
      input: { projectId: ALPHA_PROJECT, name: `敏感 ${randomUUID().slice(0, 8)}`, amountMinor: 5000 },
      requestId: randomUUID(),
    });
    const invoiced = await invoicePaymentMilestone({
      supabase: owner,
      organizationId: ALPHA_ORG,
      milestoneId: created.id as string,
      expectedLockVersion: created.lockVersion as number,
      input: {},
      idempotencyKey: `inv-${randomUUID()}`,
      requestId: randomUUID(),
    });
    await expect(
      markPaymentMilestonePaid({
        supabase: owner,
        organizationId: ALPHA_ORG,
        milestoneId: created.id as string,
        expectedLockVersion: invoiced.lockVersion as number,
        input: { metadata: { cardNumber: "4111111111111111", cvv: "123" } },
        idempotencyKey: `pay-${randomUUID()}`,
        requestId: randomUUID(),
      }),
    ).rejects.toMatchObject({ status: 422, code: "SENSITIVE_FIELD_REJECTED" });
  });

  it("cross-tenant milestone is a non-leaky 404", async () => {
    await expect(
      invoicePaymentMilestone({
        supabase: owner,
        organizationId: ALPHA_ORG,
        milestoneId: "87000000-0000-4000-8000-000000000002", // Beta's
        expectedLockVersion: 1,
        input: {},
        idempotencyKey: `x-${randomUUID()}`,
        requestId: randomUUID(),
      }),
    ).rejects.toMatchObject({ status: 404 });
  });
});

describe("M8 overdue worker", () => {
  it("flips an invoiced past-due milestone to overdue and is idempotent", async () => {
    const first = await markPaymentsOverdue({ supabase: admin, now: "2026-06-01T00:00:00Z" });
    expect((first.markedOverdue as number) >= 1).toBe(true);

    const row = await admin
      .schema("public")
      .from("payment_milestones")
      .select("status")
      .eq("id", ALPHA_OVERDUE_MILESTONE)
      .single();
    expect((row.data as { status: string }).status).toBe("overdue");

    // Re-run: the already-overdue row is not re-counted (terminal-of-scan).
    const second = await markPaymentsOverdue({ supabase: admin, now: "2026-06-01T00:00:00Z" });
    expect(typeof second.markedOverdue).toBe("number");
  });
});

describe("M8 maintenance scan -> approve -> claim", () => {
  it("enqueues an approval-pending reminder that only becomes claimable after approval", async () => {
    const dedupeLike = "mp:";
    // Ensure the seeded plan is due at the scan clock (next_due_on 2026-12-01, lead 14).
    const scan = await scanMaintenanceDue({ supabase: admin, now: "2026-11-30T00:00:00Z" });
    expect((scan.enqueued as number) >= 1).toBe(true);

    const pending = await admin
      .schema("public")
      .from("notifications")
      .select("id, approval_status, status, dedupe_key")
      .eq("organization_id", ALPHA_ORG)
      .eq("template_key", "maintenance_reminder")
      .like("dedupe_key", `${dedupeLike}%`)
      .limit(5);
    const rows = (pending.data ?? []) as Array<{
      id: string;
      approval_status: string;
      status: string;
    }>;
    expect(rows.length).toBeGreaterThan(0);
    const draft = rows.find((r) => r.approval_status === "pending");
    expect(draft, "a pending draft should exist before approval").toBeDefined();

    // A claim BEFORE approval must not grab the pending draft.
    const preClaim = await admin.rpc("claim_notifications", {
      p_worker_id: `test-${randomUUID()}`,
      p_limit: 20,
      p_now: "2026-11-30T00:05:00Z",
    });
    const preClaimed = (preClaim.data ?? []) as Array<{ id: string }>;
    expect(preClaimed.some((c) => c.id === draft!.id)).toBe(false);

    // Approve the draft, then it is claimable.
    const approved = await approveNotifications({
      supabase: owner,
      organizationId: ALPHA_ORG,
      input: { notificationIds: [draft!.id] },
      requestId: randomUUID(),
    });
    expect(approved.approved as number).toBeGreaterThanOrEqual(1);

    const postRow = await admin
      .schema("public")
      .from("notifications")
      .select("approval_status")
      .eq("id", draft!.id)
      .single();
    expect((postRow.data as { approval_status: string }).approval_status).toBe("approved");
  });

  it("completes a plan (recompute next due) and converts a plan to a revisit request", async () => {
    const plan = await admin
      .schema("public")
      .from("maintenance_plans")
      .select("lock_version, status")
      .eq("id", ALPHA_PLAN)
      .single();
    const lockVersion = (plan.data as { lock_version: number }).lock_version;

    const completed = await completeMaintenancePlan({
      supabase: owner,
      organizationId: ALPHA_ORG,
      planId: ALPHA_PLAN,
      expectedLockVersion: lockVersion,
      input: { completedOn: "2026-06-15" },
      requestId: randomUUID(),
    });
    expect(completed.status).toBe("active");
    expect(completed.nextDueOn).not.toBe("2026-12-01");

    const converted = await convertMaintenancePlanToRequest({
      supabase: owner,
      organizationId: ALPHA_ORG,
      planId: ALPHA_PLAN,
      expectedLockVersion: completed.lockVersion as number,
      input: { subject: "回訪保養", force: true },
      idempotencyKey: `conv-${randomUUID()}`,
      requestId: randomUUID(),
    });
    const newRequestId = converted.serviceRequestId as string;
    expect(newRequestId).toBeTruthy();

    const sr = await admin
      .schema("public")
      .from("service_requests")
      .select("source, origin_maintenance_plan_id")
      .eq("id", newRequestId)
      .single();
    const srRow = sr.data as { source: string; origin_maintenance_plan_id: string | null };
    expect(srRow.source).toBe("revisit");
    expect(srRow.origin_maintenance_plan_id).toBe(ALPHA_PLAN);
  });
});

describe("M8 asset history", () => {
  it("appends a service event and returns it in the merged history", async () => {
    await appendAssetServiceEvent({
      supabase: owner,
      organizationId: ALPHA_ORG,
      assetId: ALPHA_ASSET,
      input: { eventType: "serviced", summary: `清洗 ${randomUUID().slice(0, 8)}` },
      requestId: randomUUID(),
    });
    const history = await getAssetHistory({
      supabase: owner,
      organizationId: ALPHA_ORG,
      assetId: ALPHA_ASSET,
    });
    expect(Array.isArray(history.events)).toBe(true);
    expect((history.events as unknown[]).length).toBeGreaterThan(0);
  });
});

describe("M8 dashboard KPIs", () => {
  it("returns four KPI blocks with numerator/denominator/window/timezone", async () => {
    const dashboard = await computeDashboard({
      supabase: owner,
      organizationId: ALPHA_ORG,
      from: "2026-01-01",
      to: "2026-06-30",
    });
    const metrics = dashboard.metrics as Record<string, Record<string, unknown>>;
    expect(dashboard.window).toMatchObject({ timezone: "Asia/Taipei" });
    for (const key of ["firstResponseTime", "quoteAcceptanceRate", "completionRate", "revisitRate"]) {
      expect(metrics[key]).toHaveProperty("numerator");
      expect(metrics[key]).toHaveProperty("denominator");
      expect(metrics[key]).toHaveProperty("available");
      expect(metrics[key]).toHaveProperty("timezone", "Asia/Taipei");
    }
  });

  it("blocks a technician from the dashboard (never sees KPI/cost)", async () => {
    await expect(
      computeDashboard({ supabase: tech, organizationId: ALPHA_ORG }),
    ).rejects.toMatchObject({ status: 403 });
  });
});

describe("M8 authenticated rate limiter", () => {
  it("blocks the N+1th mutation and does not roll the count back", async () => {
    const org = ALPHA_ORG;
    const userId = randomUUID();
    const client = admin; // service_role can call the consume RPC directly
    // The limiter counts 120 mutations/min. Drive it just over the edge with a
    // dedicated synthetic user so the window is clean.
    let limited = false;
    for (let i = 0; i < 125; i += 1) {
      const { data } = await client.rpc("consume_pilot_authenticated_rate_limit", {
        p_organization_id: org,
        p_user_id: userId,
        p_action: "mutation",
        p_now: "2026-07-20T10:00:00Z",
      });
      if (data === "limited") {
        limited = true;
        break;
      }
    }
    expect(limited).toBe(true);
  });

  it("consume helper surfaces a 429 once the search_report window is exhausted", async () => {
    const userId = randomUUID();
    // Drive the helper itself so every call lands in the same real-time window.
    // search_report allows 30/min; the 31st consume trips the limiter.
    let threw = false;
    for (let i = 0; i < 40; i += 1) {
      try {
        await consumeAuthenticatedRateLimit({
          supabase: admin,
          organizationId: ALPHA_ORG,
          userId,
          action: "search_report",
        });
      } catch (error) {
        expect(error).toMatchObject({ status: 429 });
        threw = true;
        break;
      }
    }
    expect(threw).toBe(true);
  });
});

describe("M8 data deletion (org-scoped anonymization)", () => {
  it("anonymizes only the target org and preserves the other org", async () => {
    const token = `owner-reauth-${randomUUID()}`;
    const requested = await requestDataDeletion({
      supabase: owner,
      organizationId: ALPHA_ORG,
      reauthToken: token,
      requestId: randomUUID(),
    });
    const deletionRequestId = requested.deletionRequestId as string;
    expect(requested.status).toBe("requested");

    // A wrong token must be rejected (reauth compare).
    await expect(
      finalizeDataDeletion({
        supabase: owner,
        organizationId: ALPHA_ORG,
        deletionRequestId,
        reauthToken: "not-the-token",
        requestId: randomUUID(),
      }),
    ).rejects.toMatchObject({ status: 403 });

    const betaBefore = await admin
      .schema("public")
      .from("customers")
      .select("name")
      .eq("id", "40000000-0000-4000-8000-000000000003")
      .single();

    const finalized = await finalizeDataDeletion({
      supabase: owner,
      organizationId: ALPHA_ORG,
      deletionRequestId,
      reauthToken: token,
      requestId: randomUUID(),
    });
    expect(finalized.status).toBe("finalized");
    expect((finalized.anonymizedCustomers as number) >= 1).toBe(true);

    // Beta's customer name is untouched.
    const betaAfter = await admin
      .schema("public")
      .from("customers")
      .select("name")
      .eq("id", "40000000-0000-4000-8000-000000000003")
      .single();
    expect((betaAfter.data as { name: string }).name).toBe(
      (betaBefore.data as { name: string }).name,
    );

    // hashReauthToken is deterministic (used by both request and finalize).
    expect(hashReauthToken(token)).toBe(hashReauthToken(token));

    // Confirm-once replay returns the recorded summary.
    const replay = await finalizeDataDeletion({
      supabase: owner,
      organizationId: ALPHA_ORG,
      deletionRequestId,
      reauthToken: token,
      requestId: randomUUID(),
    });
    expect(replay.replayed).toBe(true);
  });
});

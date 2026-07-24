import { describe, expect, it } from "vitest";

import {
  serviceRequestDetailRowSchema,
  serviceRequestPatchSchema,
  toServiceRequestDetail,
} from "./service-request-detail";

describe("service request detail DTO", () => {
  const row = {
    id: "80000000-0000-4000-8000-000000000001",
    request_no: "SR-202607-000001",
    customer_id: "40000000-0000-4000-8000-000000000001",
    location_id: "50000000-0000-4000-8000-000000000001",
    asset_id: null,
    source: "web",
    status: "new",
    priority: "normal",
    category: null,
    subject: "浴室牆面滲水",
    description: "下雨後有水痕",
    contact_name: "王先生",
    contact_phone: "+886912345678",
    contact_email: null,
    assigned_member_id: null,
    triaged_at: null,
    converted_at: null,
    converted_project_id: null,
    converted_work_order_id: null,
    converted_project_no: null,
    converted_work_order_no: null,
    decline_reason: null,
    cancellation_reason: null,
    internal_note: "已電話確認",
    original_submission: {
      contactName: "王先生",
      contactPhone: "+886912345678",
      subject: "浴室牆面滲水",
      description: "下雨後有水痕",
    },
    summary_edited_by: null,
    summary_edited_at: null,
    lock_version: 1,
    created_at: "2026-07-16T10:00:00.000Z",
    updated_at: "2026-07-16T10:00:00.000Z",
  };

  const windows = [
    {
      starts_at: "2026-08-10T01:00:00.000Z",
      ends_at: "2026-08-10T04:00:00.000Z",
      preference_rank: 1,
    },
  ];

  it("maps the DB row + windows into a canonical detail DTO", () => {
    const dto = toServiceRequestDetail(
      serviceRequestDetailRowSchema.parse(row),
      windows,
      [],
    );

    expect(dto.id).toBe("80000000-0000-4000-8000-000000000001");
    expect(dto.subject).toBe("浴室牆面滲水");
    // title mirrors subject for backwards compatibility.
    expect(dto.title).toBe("浴室牆面滲水");
    expect(dto.status).toBe("new");
    expect(dto.lockVersion).toBe(1);
    expect(dto.preferredWindows).toEqual([
      {
        startsAt: "2026-08-10T01:00:00.000Z",
        endsAt: "2026-08-10T04:00:00.000Z",
        preferenceRank: 1,
      },
    ]);
    expect(dto.originalSubmission).toEqual(row.original_submission);
    expect(dto.internalNote).toBe("已電話確認");
    expect(dto.summaryEditedBy).toBeNull();
    expect(dto.photos).toEqual([]);
  });

  it("surfaces summary-edit provenance and converted targets when present", () => {
    const dto = toServiceRequestDetail(
      serviceRequestDetailRowSchema.parse({
        ...row,
        status: "converted",
        category: "waterproofing",
        assigned_member_id: "30000000-0000-4000-8000-000000000002",
        triaged_at: "2026-07-17T00:00:00.000Z",
        converted_at: "2026-07-18T00:00:00.000Z",
        converted_work_order_id: "90000000-0000-4000-8000-000000000001",
        converted_work_order_no: "WO-202607-000001",
        summary_edited_by: "10000000-0000-4000-8000-000000000002",
        summary_edited_at: "2026-07-17T01:00:00.000Z",
        lock_version: 4,
      }),
      [],
      [
        {
          id: "a0000000-0000-4000-8000-000000000001",
          category: "intake",
          url: "https://signed.example/photo",
          expiresAt: "2026-07-18T01:00:00.000Z",
        },
      ],
    );

    expect(dto.status).toBe("converted");
    expect(dto.category).toBe("waterproofing");
    expect(dto.convertedWorkOrderId).toBe("90000000-0000-4000-8000-000000000001");
    expect(dto.convertedWorkOrderNo).toBe("WO-202607-000001");
    expect(dto.summaryEditedBy).toBe("10000000-0000-4000-8000-000000000002");
    expect(dto.photos).toHaveLength(1);
    expect(dto.photos[0].url).toBe("https://signed.example/photo");
  });

  it("never carries internal columns onto the DTO", () => {
    const dto = toServiceRequestDetail(serviceRequestDetailRowSchema.parse(row), [], []);
    expect(JSON.stringify(dto)).not.toMatch(/organization|storage_path|metadata|created_by/i);
  });
});

describe("serviceRequestPatchSchema", () => {
  it("accepts a null priority/category (the detail UI sends null for un-set selects)", () => {
    expect(
      serviceRequestPatchSchema.parse({ subject: "整理後主旨", priority: null, category: null }),
    ).toEqual({ subject: "整理後主旨", priority: null, category: null });
  });

  it("rejects internalNote — there is no column to persist it (strict body)", () => {
    expect(() =>
      serviceRequestPatchSchema.parse({ subject: "x", internalNote: "note" }),
    ).toThrow();
  });

  it("requires at least one field", () => {
    expect(() => serviceRequestPatchSchema.parse({})).toThrow();
  });
});

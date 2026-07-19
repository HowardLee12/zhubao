import { describe, expect, it } from "vitest";

import { triageRequestSchema } from "./triage";

describe("triageRequestSchema", () => {
  const customerId = "40000000-0000-4000-8000-000000000001";

  it("accepts the minimal triage body with only a customer", () => {
    expect(triageRequestSchema.parse({ customerId })).toEqual({ customerId });
  });

  it("accepts every optional binding and override", () => {
    const body = {
      customerId,
      locationId: "50000000-0000-4000-8000-000000000001",
      assetId: "60000000-0000-4000-8000-000000000001",
      assignedMemberId: "30000000-0000-4000-8000-000000000002",
      priority: "high" as const,
      category: "waterproofing",
      internalNote: "客戶希望週末",
    };
    expect(triageRequestSchema.parse(body)).toEqual(body);
  });

  it("requires a customer id", () => {
    expect(() => triageRequestSchema.parse({})).toThrow();
  });

  it("rejects a non-uuid customer id", () => {
    expect(() => triageRequestSchema.parse({ customerId: "not-a-uuid" })).toThrow();
  });

  it("rejects an unknown priority", () => {
    expect(() => triageRequestSchema.parse({ customerId, priority: "critical" })).toThrow();
  });

  it("rejects unknown properties", () => {
    expect(() => triageRequestSchema.parse({ customerId, lockVersion: 3 })).toThrow();
  });

  it("allows nulling location/asset/assignee to clear a prior binding", () => {
    expect(
      triageRequestSchema.parse({ customerId, locationId: null, assetId: null }),
    ).toEqual({ customerId, locationId: null, assetId: null });
  });

  it("accepts a null priority/category (maps to keep-existing at the RPC)", () => {
    // The detail UI sends `category: form.category || null` for an un-set select;
    // the RPC coalesces null to the current value, so the body must accept null.
    expect(
      triageRequestSchema.parse({ customerId, priority: null, category: null }),
    ).toEqual({ customerId, priority: null, category: null });
  });
});

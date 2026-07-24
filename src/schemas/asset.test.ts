import { describe, expect, it } from "vitest";

import {
  appendAssetServiceEventSchema,
  assetRowSchema,
  patchAssetSchema,
  retireAssetSchema,
  toAssetDto,
} from "./asset";

describe("asset read DTO", () => {
  const dbRow = {
    id: "60000000-0000-4000-8000-000000000001",
    customer_id: "40000000-0000-4000-8000-000000000001",
    location_id: "50000000-0000-4000-8000-000000000001",
    asset_no: "A-2026-0001",
    asset_type: "air_conditioner",
    name: "主臥冷氣",
    brand: "示範品牌",
    model: "DEMO-01",
    serial_number: null,
    installed_on: "2025-06-01",
    status: "active",
    lock_version: 1,
    created_at: "2026-01-02T00:00:00.000Z",
    updated_at: "2026-01-02T00:00:00.000Z",
  };

  it("maps a DB row to a camelCase DTO", () => {
    const dto = toAssetDto(assetRowSchema.parse(dbRow));
    expect(dto).toEqual({
      id: "60000000-0000-4000-8000-000000000001",
      customerId: "40000000-0000-4000-8000-000000000001",
      locationId: "50000000-0000-4000-8000-000000000001",
      assetNo: "A-2026-0001",
      assetType: "air_conditioner",
      name: "主臥冷氣",
      brand: "示範品牌",
      model: "DEMO-01",
      serialNumber: null,
      installedOn: "2025-06-01",
      status: "active",
      lockVersion: 1,
      createdAt: "2026-01-02T00:00:00.000Z",
      updatedAt: "2026-01-02T00:00:00.000Z",
    });
  });

  it("rejects an unknown asset type", () => {
    expect(() => assetRowSchema.parse({ ...dbRow, asset_type: "spaceship" })).toThrow();
  });
});

describe("asset mutation schemas", () => {
  it("patch accepts partial nullable fields and rejects unknown keys", () => {
    expect(patchAssetSchema.safeParse({ brand: "Daikin" }).success).toBe(true);
    expect(patchAssetSchema.safeParse({ serialNumber: null }).success).toBe(true);
    expect(patchAssetSchema.safeParse({ cost: 100 }).success).toBe(false);
  });

  it("retire accepts an optional reason", () => {
    expect(retireAssetSchema.safeParse({}).success).toBe(true);
    expect(retireAssetSchema.safeParse({ reason: "汰換" }).success).toBe(true);
  });

  it("service event validates the event type and requires a summary", () => {
    expect(
      appendAssetServiceEventSchema.safeParse({ eventType: "serviced", summary: "清洗" }).success,
    ).toBe(true);
    expect(
      appendAssetServiceEventSchema.safeParse({ eventType: "exploded", summary: "x" }).success,
    ).toBe(false);
    expect(
      appendAssetServiceEventSchema.safeParse({ eventType: "note", summary: "" }).success,
    ).toBe(false);
  });
});

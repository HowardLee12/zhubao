import { describe, expect, it } from "vitest";

import { assetRowSchema, toAssetDto } from "./asset";

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

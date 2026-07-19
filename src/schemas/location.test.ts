import { describe, expect, it } from "vitest";

import { locationRowSchema, toLocationDto } from "./location";

describe("location read DTO", () => {
  const dbRow = {
    id: "50000000-0000-4000-8000-000000000001",
    customer_id: "40000000-0000-4000-8000-000000000001",
    label: "住家",
    contact_name: "王先生",
    contact_phone: "+886912345678",
    postal_code: "105",
    county: "台北市",
    district: "松山區",
    address_line: "民生東路四段 88 號",
    access_notes: "側門進入",
    is_default: true,
    lock_version: 1,
    created_at: "2026-01-02T00:00:00.000Z",
    updated_at: "2026-01-02T00:00:00.000Z",
  };

  it("maps a DB row to a camelCase DTO", () => {
    const dto = toLocationDto(locationRowSchema.parse(dbRow));
    expect(dto).toEqual({
      id: "50000000-0000-4000-8000-000000000001",
      customerId: "40000000-0000-4000-8000-000000000001",
      label: "住家",
      contactName: "王先生",
      contactPhone: "+886912345678",
      postalCode: "105",
      county: "台北市",
      district: "松山區",
      addressLine: "民生東路四段 88 號",
      accessNotes: "側門進入",
      isDefault: true,
      lockVersion: 1,
      createdAt: "2026-01-02T00:00:00.000Z",
      updatedAt: "2026-01-02T00:00:00.000Z",
    });
  });

  it("preserves nullable contact and administrative fields", () => {
    const dto = toLocationDto(
      locationRowSchema.parse({
        ...dbRow,
        contact_name: null,
        contact_phone: null,
        postal_code: null,
        county: null,
        district: null,
      }),
    );
    expect(dto.contactName).toBeNull();
    expect(dto.postalCode).toBeNull();
    expect(dto.county).toBeNull();
  });
});

import { describe, expect, it } from "vitest";

import {
  createPilotCustomerSchema,
  customerRowSchema,
  similarCustomerRpcSchema,
  toCustomerDto,
  toSimilarCustomer,
} from "./customer";

describe("pilot customer create input", () => {
  it("trims the customer name and accepts a nullable E.164 phone", () => {
    expect(
      createPilotCustomerSchema.parse({
        name: "  林太太  ",
        phone: "+886912345678",
      }),
    ).toEqual({ name: "林太太", phone: "+886912345678" });
    expect(createPilotCustomerSchema.parse({ name: "無電話客戶", phone: null })).toEqual({
      name: "無電話客戶",
      phone: null,
    });
  });

  it("rejects unknown fields and non-E.164 phone numbers", () => {
    expect(() =>
      createPilotCustomerSchema.parse({ name: "林太太", phone: "0912345678" }),
    ).toThrow();
    expect(() =>
      createPilotCustomerSchema.parse({ name: "林太太", phone: null, organizationId: "x" }),
    ).toThrow();
  });
});

describe("customer read DTO", () => {
  const dbRow = {
    id: "40000000-0000-4000-8000-000000000001",
    customer_no: "C-2026-0001",
    kind: "individual",
    name: "示範客戶甲",
    phone: "+886912345678",
    email: "customer.alpha@example.test",
    company_name: null,
    source: "manual",
    notes: "",
    last_contact_at: "2026-07-01T00:00:00.000Z",
    lock_version: 1,
    created_at: "2026-01-02T00:00:00.000Z",
    updated_at: "2026-01-02T00:00:00.000Z",
  };

  it("parses a DB row and maps it to a camelCase DTO without cost data", () => {
    const parsed = customerRowSchema.parse(dbRow);
    const dto = toCustomerDto(parsed);
    expect(dto).toEqual({
      id: "40000000-0000-4000-8000-000000000001",
      customerNo: "C-2026-0001",
      kind: "individual",
      name: "示範客戶甲",
      phone: "+886912345678",
      email: "customer.alpha@example.test",
      companyName: null,
      source: "manual",
      notes: "",
      lastContactAt: "2026-07-01T00:00:00.000Z",
      lockVersion: 1,
      createdAt: "2026-01-02T00:00:00.000Z",
      updatedAt: "2026-01-02T00:00:00.000Z",
    });
    expect(JSON.stringify(dto)).not.toMatch(/cost|tax_id|deleted_at|organization/i);
  });

  it("preserves nullable phone/email/company", () => {
    const dto = toCustomerDto(
      customerRowSchema.parse({
        ...dbRow,
        phone: null,
        email: null,
        company_name: "示範公司",
      }),
    );
    expect(dto.phone).toBeNull();
    expect(dto.email).toBeNull();
    expect(dto.companyName).toBe("示範公司");
  });
});

describe("similar customer hint DTO", () => {
  it("maps the find_similar_customers RPC row to a hint DTO", () => {
    const rpcRow = {
      customer_id: "40000000-0000-4000-8000-000000000001",
      customer_no: "C-2026-0001",
      name: "示範客戶甲",
      phone: "+886912345678",
      match_reason: "phone",
    };
    expect(toSimilarCustomer(similarCustomerRpcSchema.parse(rpcRow))).toEqual({
      customerId: "40000000-0000-4000-8000-000000000001",
      customerNo: "C-2026-0001",
      name: "示範客戶甲",
      phone: "+886912345678",
      matchReason: "phone",
    });
  });

  it("preserves a null phone on a name match", () => {
    const dto = toSimilarCustomer(
      similarCustomerRpcSchema.parse({
        customer_id: "40000000-0000-4000-8000-000000000002",
        customer_no: "C-2026-0002",
        name: "示範客戶乙",
        phone: null,
        match_reason: "name",
      }),
    );
    expect(dto.phone).toBeNull();
    expect(dto.matchReason).toBe("name");
  });

  it("rejects an unknown match reason", () => {
    expect(() =>
      similarCustomerRpcSchema.parse({
        customer_id: "40000000-0000-4000-8000-000000000002",
        customer_no: "C-2026-0002",
        name: "x",
        phone: null,
        match_reason: "address",
      }),
    ).toThrow();
  });
});

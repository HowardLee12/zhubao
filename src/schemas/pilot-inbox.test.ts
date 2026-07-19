import { describe, expect, it } from "vitest";

import { pilotInboxRpcResultSchema, toPilotInboxItem } from "./pilot-inbox";

describe("pilotInboxRpcResultSchema", () => {
  const row = {
    id: "4c76d4c5-c978-4bdb-a918-caa82988e5fa",
    requestNo: "SR-2026-00001",
    contactName: "王先生",
    contactPhone: "+886912345678",
    subject: "浴室牆面滲水",
    description: "下雨後有水痕",
    status: "new" as const,
    priority: "normal" as const,
    serviceCatalogItemId: "71100000-0000-4000-8000-000000000001",
    serviceName: "現場估價",
    category: "防水工程",
    address: "台北市松山區民生東路四段 88 號",
    photoCount: 2,
    preferredWindows: [
      {
        startsAt: "2026-08-10T01:00:00.000Z",
        endsAt: "2026-08-10T04:00:00.000Z",
        preferenceRank: 1,
      },
    ],
    createdAt: "2026-07-16T10:00:00.000Z",
    updatedAt: "2026-07-16T10:00:00.000Z",
  };

  const result = {
    organizationId: "20000000-0000-4000-8000-000000000001",
    items: [row],
  };

  it("accepts the allowlisted staff inbox projection", () => {
    expect(pilotInboxRpcResultSchema.parse(result)).toEqual(result);
  });

  it("rejects internal tenant and storage fields on rows", () => {
    expect(() =>
      pilotInboxRpcResultSchema.parse({
        organizationId: result.organizationId,
        items: [{ ...row, storagePath: "private/photo.jpg", defaultCostMinor: 12000 }],
      }),
    ).toThrow();
  });

  it("requires the organizationId + items envelope shape", () => {
    expect(() => pilotInboxRpcResultSchema.parse([row])).toThrow();
  });

  it("maps an RPC row to the UI-facing inbox item", () => {
    expect(toPilotInboxItem(row)).toEqual({
      id: row.id,
      referenceNo: "SR-2026-00001",
      source: "web",
      contactName: "王先生",
      contactPhone: "+886912345678",
      serviceName: "現場估價",
      category: "防水工程",
      title: "浴室牆面滲水",
      description: "下雨後有水痕",
      address: "台北市松山區民生東路四段 88 號",
      photoCount: 2,
      status: "new",
      priority: "normal",
      createdAt: "2026-07-16T10:00:00.000Z",
    });
  });

  it("preserves nullable service and address fields through the mapper", () => {
    const mapped = toPilotInboxItem({
      ...row,
      serviceCatalogItemId: null,
      serviceName: null,
      category: null,
      address: null,
    });
    expect(mapped.serviceName).toBeNull();
    expect(mapped.category).toBeNull();
    expect(mapped.address).toBeNull();
  });
});

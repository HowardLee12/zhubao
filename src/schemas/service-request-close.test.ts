import { describe, expect, it } from "vitest";

import { serviceRequestCloseSchema } from "./service-request-close";

describe("serviceRequestCloseSchema", () => {
  it("accepts a non-empty reason", () => {
    expect(serviceRequestCloseSchema.parse({ reason: "客戶自行處理" })).toEqual({
      reason: "客戶自行處理",
    });
  });

  it("rejects a missing reason", () => {
    expect(() => serviceRequestCloseSchema.parse({})).toThrow();
  });

  it("rejects an empty reason", () => {
    expect(() => serviceRequestCloseSchema.parse({ reason: "" })).toThrow();
  });

  it("rejects an overly long reason", () => {
    expect(() =>
      serviceRequestCloseSchema.parse({ reason: "x".repeat(2001) }),
    ).toThrow();
  });

  it("rejects unknown properties", () => {
    expect(() =>
      serviceRequestCloseSchema.parse({ reason: "ok", extra: 1 }),
    ).toThrow();
  });
});

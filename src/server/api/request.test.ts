import { describe, expect, it } from "vitest";
import { z } from "zod";

import { parseJsonBody, resolveRequestId } from "./request";

describe("resolveRequestId", () => {
  it("keeps a valid caller request id", () => {
    const id = "67427c45-e326-4a0a-b7b7-82cf53999df7";
    expect(resolveRequestId(id)).toBe(id);
  });

  it("replaces an invalid request id", () => {
    expect(resolveRequestId("../../secret")).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });
});

describe("parseJsonBody", () => {
  const schema = z.object({ name: z.string().min(1) }).strict();

  it("returns strictly validated data", async () => {
    const request = new Request("https://renoly.test/api", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "北城工程" }),
    });

    await expect(parseJsonBody(request, schema)).resolves.toEqual({ name: "北城工程" });
  });

  it("rejects unknown fields with field-level errors", async () => {
    const request = new Request("https://renoly.test/api", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "北城工程", role: "owner" }),
    });

    await expect(parseJsonBody(request, schema)).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
      status: 422,
      errors: expect.arrayContaining([expect.objectContaining({ path: "" })]),
    });
  });

  it("rejects malformed JSON without exposing parser internals", async () => {
    const request = new Request("https://renoly.test/api", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{broken",
    });

    await expect(parseJsonBody(request, schema)).rejects.toMatchObject({
      code: "MALFORMED_REQUEST",
      status: 400,
      detail: "Request body must be valid JSON.",
    });
  });

  it("rejects browser form content types for mutations", async () => {
    const request = new Request("https://renoly.test/api", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "name=test",
    });

    await expect(parseJsonBody(request, schema)).rejects.toMatchObject({
      code: "UNSUPPORTED_MEDIA_TYPE",
      status: 415,
    });
  });

  it("stops reading JSON bodies that exceed the endpoint limit", async () => {
    const request = new Request("https://renoly.test/api", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "a".repeat(100) }),
    });

    await expect(parseJsonBody(request, schema, { maxBytes: 32 })).rejects.toMatchObject({
      code: "PAYLOAD_TOO_LARGE",
      status: 413,
    });
  });
});

import { describe, expect, it } from "vitest";

import {
  isKnownTemplateKey,
  renderLineTemplate,
  TEMPLATE_KEYS,
} from "./templates";

describe("template registry", () => {
  it("exposes exactly the M6 allowlisted keys", () => {
    expect([...TEMPLATE_KEYS]).toEqual([
      "received",
      "quote_sent",
      "appointment_confirmed",
      "en_route",
      "completed",
      "payment_reminder",
    ]);
  });

  it("recognises a known key and rejects an unknown one", () => {
    expect(isKnownTemplateKey("received")).toBe(true);
    expect(isKnownTemplateKey("drop_table")).toBe(false);
  });
});

describe("renderLineTemplate", () => {
  it("renders the received template into a text message", () => {
    const messages = renderLineTemplate("received", { customerName: "王先生" });
    expect(Array.isArray(messages)).toBe(true);
    expect(messages[0]?.type).toBe("text");
    expect(String(messages[0]?.text)).toContain("王先生");
  });

  it("places user-supplied text ONLY into the text field, never structural keys", () => {
    // A hostile value that would break JSON if concatenated. It must appear verbatim
    // inside the text field and must not alter the message structure.
    const hostile = '"}],"to":"attacker","x":"';
    const messages = renderLineTemplate("quote_sent", {
      customerName: hostile,
      quoteNumber: "Q-001",
      amountLabel: "NT$12,000",
    });
    expect(messages).toHaveLength(1);
    expect(messages[0]?.type).toBe("text");
    expect(String(messages[0]?.text)).toContain(hostile);
    // Structure is intact: exactly the two keys of a text message.
    expect(Object.keys(messages[0] ?? {}).sort()).toEqual(["text", "type"]);
  });

  it("renders each allowlisted template without throwing", () => {
    for (const key of TEMPLATE_KEYS) {
      const messages = renderLineTemplate(key, {
        customerName: "客戶",
        quoteNumber: "Q-1",
        amountLabel: "NT$1",
        scheduledAt: "2026-07-20 10:00",
        workOrderNumber: "W-1",
        technicianName: "師傅",
      });
      expect(messages.length).toBeGreaterThan(0);
      expect(messages[0]?.type).toBe("text");
    }
  });

  it("falls back to a neutral greeting when a value is empty/whitespace", () => {
    const messages = renderLineTemplate("received", { customerName: "   " });
    expect(String(messages[0]?.text)).toContain("您好");
  });

  it("falls back when a value is entirely absent", () => {
    const messages = renderLineTemplate("received", {});
    expect(String(messages[0]?.text)).toContain("您好");
  });

  it("throws on an unknown template key (allowlist enforced at render)", () => {
    // @ts-expect-error intentionally passing an unknown key
    expect(() => renderLineTemplate("evil", {})).toThrow(/unknown template/i);
  });

  it("truncates an over-long text field to LINE's 5000-char ceiling", () => {
    const messages = renderLineTemplate("received", { customerName: "x".repeat(6000) });
    expect(String(messages[0]?.text).length).toBeLessThanOrEqual(5000);
  });
});

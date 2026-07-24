import { describe, expect, it } from "vitest";

import { POST as legacyAuthPost } from "@/app/api/auth/route";
import { POST as legacyEcpayCallbackPost } from "@/app/api/ecpay/callback/route";
import { GET as legacyEcpayCheckoutGet } from "@/app/api/ecpay/checkout/route";
import {
  GET as legacyEcpayResultGet,
  POST as legacyEcpayResultPost,
} from "@/app/api/ecpay/result/route";
import { POST as legacyPhotoUploadPost } from "@/app/api/photos/upload/route";
import { GET as legacyQuoteGet } from "@/app/api/quotes/[id]/route";

describe("remaining incompatible v1 API quarantine", () => {
  it("returns an indistinguishable 404 from every old auth, payment, photo and quote API", async () => {
    const handlers = [
      legacyAuthPost,
      legacyEcpayCallbackPost,
      legacyEcpayCheckoutGet,
      legacyEcpayResultGet,
      legacyEcpayResultPost,
      legacyPhotoUploadPost,
      legacyQuoteGet,
    ];

    const responses = await Promise.all(
      handlers.map((handler) => (handler as unknown as () => Promise<Response>)()),
    );

    expect(responses.map(({ status }) => status)).toEqual(Array(handlers.length).fill(404));
    for (const response of responses) {
      expect(response.headers.get("cache-control")).toBe("no-store");
    }
  });
});

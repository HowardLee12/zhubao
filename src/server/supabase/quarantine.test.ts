import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ getUserId: vi.fn().mockResolvedValue(null) }));
vi.mock("@/lib/threads", () => ({
  getThreadsProfile: vi.fn(),
  postToThreads: vi.fn(),
}));
vi.mock("@/lib/queries", () => ({
  getUserProfile: vi.fn().mockResolvedValue(null),
  getQuote: vi.fn().mockResolvedValue({
    id: "11111111-1111-4111-8111-111111111111",
    project_id: "22222222-2222-4222-8222-222222222222",
    version: 1,
    sections: [],
  }),
}));
vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          single: vi.fn().mockResolvedValue({ data: {}, error: null }),
        })),
      })),
    })),
  },
}));

import { GET as callbackGet } from "@/app/api/threads/callback/route";
import {
  GET as deauthorizeGet,
  POST as deauthorizePost,
} from "@/app/api/threads/deauthorize/route";
import {
  GET as deleteGet,
  POST as deletePost,
} from "@/app/api/threads/delete/route";
import {
  GET as threadsPostGet,
  POST as threadsPostPost,
} from "@/app/api/threads/post/route";
import { GET as startGet } from "@/app/api/threads/start/route";
import { GET as legacyPdfGet } from "@/app/api/quotes/[id]/pdf/route";
import QuoteSharePage from "@/app/(public)/quotes/[id]/share/page";

describe("legacy surface quarantine", () => {
  it("returns 404 from every legacy Threads handler without executing OAuth or posting", async () => {
    const responses = await Promise.all([
      startGet(),
      callbackGet(),
      deauthorizeGet(),
      deauthorizePost(),
      deleteGet(),
      deletePost(),
      threadsPostGet(),
      threadsPostPost(),
    ]);

    expect(responses.map((response) => response.status)).toEqual(
      Array(8).fill(404),
    );
  });

  it("returns 404 for the UUID-addressable legacy PDF route", async () => {
    const response = await legacyPdfGet();

    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("always not-found the UUID-addressable legacy quote share page", async () => {
    await expect(
      QuoteSharePage(),
    ).rejects.toThrow(/404/);
  });
});

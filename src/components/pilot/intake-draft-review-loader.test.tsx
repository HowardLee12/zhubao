import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PilotIntakeDraftReviewLoader } from "./intake-draft-review-loader";

const organizationId = "20000000-0000-4000-8000-000000000001";
const draftId = "90000000-0000-4000-8000-000000000001";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("PilotIntakeDraftReviewLoader", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders the review workflow for the given draft id", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            user: { id: "u", email: "o@x.test", displayName: "王老闆" },
            memberships: [
              {
                id: "m",
                organizationId,
                role: "owner",
                status: "active",
                displayName: "王老闆",
              },
            ],
          },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            id: draftId,
            conversationId: "a0000000-0000-4000-8000-000000000001",
            status: "pending_review",
            origin: "ai",
            source: "line",
            title: "LINE 進件",
            summary: "冷氣不冷",
            confidence: 0.8,
            fields: {},
            missingFields: [],
            lineUserId: "Uline-1",
            customerLineIdentityId: null,
            convertedServiceRequestId: null,
            lockVersion: 1,
            createdAt: "2026-07-18T01:59:00.000Z",
            updatedAt: "2026-07-18T02:00:00.000Z",
            messages: [],
          },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    render(<PilotIntakeDraftReviewLoader draftId={draftId} />);

    expect(await screen.findByRole("heading", { name: /原始訊息/ })).toBeInTheDocument();
    // The detail request targets the given draft id.
    const detailCall = fetchMock.mock.calls[1][0] as string;
    expect(detailCall).toContain(`/intake-drafts/${draftId}`);
  });
});

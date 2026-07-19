import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PilotRequestDetailLoader } from "./request-detail-loader";

const organizationId = "20000000-0000-4000-8000-000000000001";
const requestId = "80000000-0000-4000-8000-000000000001";

const pilotApi = vi.hoisted(() => ({ fetchPilotSession: vi.fn() }));

vi.mock("./api", () => pilotApi);
vi.mock("./request-detail", () => ({
  PilotRequestDetail: ({
    organizationId: orgId,
    requestId: reqId,
  }: {
    organizationId: string;
    requestId: string;
  }) => (
    <div data-testid="detail">
      {orgId}:{reqId}
    </div>
  ),
}));

function session() {
  return {
    user: { id: "u1", email: "o@e.test", displayName: "王老闆" },
    memberships: [
      { id: "m1", organizationId, role: "owner", status: "active", displayName: "王老闆" },
    ],
  };
}

describe("PilotRequestDetailLoader", () => {
  afterEach(() => vi.clearAllMocks());

  it("resolves the active organization and renders the detail workflow", async () => {
    pilotApi.fetchPilotSession.mockResolvedValue(session());

    render(<PilotRequestDetailLoader requestId={requestId} />);

    expect(screen.getByRole("status", { name: /載入/ })).toBeInTheDocument();
    expect(await screen.findByTestId("detail")).toHaveTextContent(
      `${organizationId}:${requestId}`,
    );
  });

  it("shows an error with retry when the session cannot be resolved", async () => {
    pilotApi.fetchPilotSession
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce(session());

    render(<PilotRequestDetailLoader requestId={requestId} />);

    expect(await screen.findByRole("alert")).toHaveTextContent("無法載入工作空間");
    await userEvent.click(screen.getByRole("button", { name: "重新載入" }));
    await waitFor(() => expect(screen.getByTestId("detail")).toBeInTheDocument());
  });

  it("errors when the member has no active workspace", async () => {
    pilotApi.fetchPilotSession.mockResolvedValue({
      user: { id: "u1", email: "o@e.test", displayName: "王老闆" },
      memberships: [],
    });

    render(<PilotRequestDetailLoader requestId={requestId} />);

    expect(await screen.findByRole("alert")).toHaveTextContent("無法載入工作空間");
  });
});

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const pilotApi = vi.hoisted(() => ({ fetchPilotSession: vi.fn() }));
const api = vi.hoisted(() => ({
  requestDataDeletion: vi.fn(),
  finalizeDataDeletion: vi.fn(),
}));

vi.mock("./api", () => ({ fetchPilotSession: pilotApi.fetchPilotSession }));
vi.mock("./operations-api", () => api);

import { DataDeletionSettings } from "./data-deletion-settings";

const ORG = "20000000-0000-4000-8000-000000000001";

function session(role: string) {
  return {
    user: { id: "u1", email: "o@t.test", displayName: "O" },
    memberships: [{ id: "m1", organizationId: ORG, displayName: "O", role, status: "active" }],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  pilotApi.fetchPilotSession.mockResolvedValue(session("owner"));
  api.requestDataDeletion.mockResolvedValue({ deletionRequestId: "del-1", status: "requested" });
  api.finalizeDataDeletion.mockResolvedValue({ status: "finalized", anonymizedCustomers: 3 });
});

describe("DataDeletionSettings", () => {
  it("requires the owner to re-authenticate before requesting deletion", async () => {
    render(<DataDeletionSettings />);
    await screen.findByRole("button", { name: "開始刪除流程" });

    // Empty re-auth material blocks the request.
    await userEvent.click(screen.getByRole("button", { name: "開始刪除流程" }));
    expect(api.requestDataDeletion).not.toHaveBeenCalled();

    await userEvent.type(screen.getByLabelText("再次輸入登入密碼"), "RenolyDemo-Owner-2026");
    await userEvent.click(screen.getByRole("button", { name: "開始刪除流程" }));
    await waitFor(() => expect(api.requestDataDeletion).toHaveBeenCalledTimes(1));
    expect(api.requestDataDeletion).toHaveBeenCalledWith(ORG, "RenolyDemo-Owner-2026");
  });

  it("finalizes only after an explicit confirm", async () => {
    render(<DataDeletionSettings />);
    await screen.findByLabelText("再次輸入登入密碼");
    await userEvent.type(screen.getByLabelText("再次輸入登入密碼"), "RenolyDemo-Owner-2026");
    await userEvent.click(screen.getByRole("button", { name: "開始刪除流程" }));

    await screen.findByRole("button", { name: "確認永久匿名化" });
    await userEvent.click(screen.getByRole("button", { name: "確認永久匿名化" }));
    await waitFor(() => expect(api.finalizeDataDeletion).toHaveBeenCalledTimes(1));
    expect(api.finalizeDataDeletion).toHaveBeenCalledWith(ORG, "del-1", "RenolyDemo-Owner-2026");
    expect(await screen.findByText(/已完成匿名化/)).toBeInTheDocument();
  });

  it("hides deletion from a non-owner (owner-only surface)", async () => {
    pilotApi.fetchPilotSession.mockResolvedValue(session("dispatcher"));
    render(<DataDeletionSettings />);
    await screen.findByText(/僅開放給負責人/);
    expect(screen.queryByRole("button", { name: "開始刪除流程" })).toBeNull();
  });

  it("surfaces an error when the request fails", async () => {
    api.requestDataDeletion.mockRejectedValueOnce(new Error("nope"));
    render(<DataDeletionSettings />);
    await screen.findByLabelText("再次輸入登入密碼");
    await userEvent.type(screen.getByLabelText("再次輸入登入密碼"), "RenolyDemo-Owner-2026");
    await userEvent.click(screen.getByRole("button", { name: "開始刪除流程" }));
    expect(await screen.findByText(/nope|無法開始刪除流程/)).toBeInTheDocument();
  });

  it("errors when there is no active membership yet", async () => {
    pilotApi.fetchPilotSession.mockResolvedValue({
      user: { id: "u1", email: "o@t.test", displayName: "O" },
      memberships: [],
    });
    render(<DataDeletionSettings />);
    await screen.findByText("頁面暫時讀不到");
  });

  it("does not set state after unmount (cleanup guard)", async () => {
    let resolveSession: (value: unknown) => void = () => {};
    pilotApi.fetchPilotSession.mockReturnValue(
      new Promise((resolve) => {
        resolveSession = resolve;
      }),
    );
    const view = render(<DataDeletionSettings />);
    view.unmount();
    resolveSession(session("owner"));
    await Promise.resolve();
    await Promise.resolve();
    expect(screen.queryByText("刪除店家資料")).toBeNull();
  });

  it("shows an error state when the session cannot load, and can retry", async () => {
    pilotApi.fetchPilotSession.mockRejectedValueOnce(new Error("no session"));
    render(<DataDeletionSettings />);
    await screen.findByText("頁面暫時讀不到");
    expect(screen.getByRole("button", { name: "重新載入" })).toBeInTheDocument();
  });

  it("blocks a too-short re-auth token before hitting the API", async () => {
    render(<DataDeletionSettings />);
    await screen.findByLabelText("再次輸入登入密碼");
    await userEvent.type(screen.getByLabelText("再次輸入登入密碼"), "short");
    await userEvent.click(screen.getByRole("button", { name: "開始刪除流程" }));
    expect(await screen.findByText(/至少 8 個字元/)).toBeInTheDocument();
    expect(api.requestDataDeletion).not.toHaveBeenCalled();
  });

  it("finalizes without a customer count and still confirms success", async () => {
    api.finalizeDataDeletion.mockResolvedValue({ status: "finalized" });
    render(<DataDeletionSettings />);
    await screen.findByLabelText("再次輸入登入密碼");
    await userEvent.type(screen.getByLabelText("再次輸入登入密碼"), "RenolyDemo-Owner-2026");
    await userEvent.click(screen.getByRole("button", { name: "開始刪除流程" }));
    await userEvent.click(await screen.findByRole("button", { name: "確認永久匿名化" }));
    expect(await screen.findByText(/已完成匿名化/)).toBeInTheDocument();
  });

  it("surfaces an error when the finalize fails", async () => {
    api.finalizeDataDeletion.mockRejectedValueOnce(new Error("bad"));
    render(<DataDeletionSettings />);
    await screen.findByLabelText("再次輸入登入密碼");
    await userEvent.type(screen.getByLabelText("再次輸入登入密碼"), "RenolyDemo-Owner-2026");
    await userEvent.click(screen.getByRole("button", { name: "開始刪除流程" }));
    await userEvent.click(await screen.findByRole("button", { name: "確認永久匿名化" }));
    expect(await screen.findByText(/bad|無法完成刪除/)).toBeInTheDocument();
  });
});

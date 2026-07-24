import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const pilotApi = vi.hoisted(() => ({ fetchPilotSession: vi.fn() }));
const api = vi.hoisted(() => ({
  fetchLineChannels: vi.fn(),
  connectLineChannel: vi.fn(),
  disableLineChannel: vi.fn(),
}));

vi.mock("./api", () => ({ fetchPilotSession: pilotApi.fetchPilotSession }));
vi.mock("./line-notifications-api", () => ({
  fetchLineChannels: api.fetchLineChannels,
  connectLineChannel: api.connectLineChannel,
  disableLineChannel: api.disableLineChannel,
}));

import { LineChannelSettings } from "./line-channel-settings";

const ORG = "20000000-0000-4000-8000-000000000001";

function session(role: string) {
  return { user: { id: "u1", email: "o@t.test", displayName: "O" }, memberships: [{ id: "m1", organizationId: ORG, displayName: "O", role, status: "active" }] };
}

function connectedChannel() {
  return {
    id: "a1c00000-0000-4000-8000-000000000001",
    name: "Alpha 官方帳號",
    channelId: "alpha-oa-channel-id",
    basicId: "@alpha",
    liffId: null,
    status: "active" as const,
    credentialConfigured: true,
    webhookVerifiedAt: "2026-01-03T00:00:00+00:00",
    lastWebhookAt: null,
    lastErrorCode: null,
    lockVersion: 1,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  pilotApi.fetchPilotSession.mockResolvedValue(session("owner"));
  api.fetchLineChannels.mockResolvedValue([]);
  api.connectLineChannel.mockResolvedValue({
    id: connectedChannel().id,
    status: "active",
    credentialConfigured: true,
  });
  api.disableLineChannel.mockResolvedValue(undefined);
});

describe("LineChannelSettings", () => {
  it("shows the honest 未連接 state when no channel is connected", async () => {
    render(<LineChannelSettings />);
    await screen.findByText("LINE 未連接");
  });

  it("connects a channel and never sends the secret back to the browser as display text", async () => {
    api.fetchLineChannels.mockResolvedValueOnce([]).mockResolvedValueOnce([connectedChannel()]);
    render(<LineChannelSettings />);

    await screen.findByText("LINE 未連接");
    await userEvent.type(screen.getByLabelText("顯示名稱"), "Alpha 官方帳號");
    await userEvent.type(screen.getByLabelText("Channel ID"), "alpha-oa-channel-id");
    await userEvent.type(screen.getByLabelText("Channel secret"), "super-secret");
    await userEvent.type(screen.getByLabelText("長期 access token"), "long-token");
    await userEvent.click(screen.getByRole("button", { name: "連接 LINE" }));

    await waitFor(() => expect(api.connectLineChannel).toHaveBeenCalledTimes(1));
    expect(api.connectLineChannel).toHaveBeenCalledWith(
      ORG,
      expect.objectContaining({ channelSecret: "super-secret", accessToken: "long-token" }),
    );
    await screen.findByText("已連接");
  });

  it("blocks a technician (no manage permission)", async () => {
    pilotApi.fetchPilotSession.mockResolvedValue(session("technician"));
    render(<LineChannelSettings />);
    await screen.findByText("你沒有管理權限");
    expect(api.fetchLineChannels).not.toHaveBeenCalled();
  });

  it("lets an owner disable a connected channel (kill switch)", async () => {
    api.fetchLineChannels
      .mockResolvedValueOnce([connectedChannel()])
      .mockResolvedValueOnce([]);
    render(<LineChannelSettings />);

    await screen.findByText("已連接");
    await userEvent.click(screen.getByRole("button", { name: /停用 LINE 連接/ }));
    await waitFor(() => expect(api.disableLineChannel).toHaveBeenCalledTimes(1));
    await screen.findByText("LINE 未連接");
  });
});

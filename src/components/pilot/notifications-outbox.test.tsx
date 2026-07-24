import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const pilotApi = vi.hoisted(() => ({ fetchPilotSession: vi.fn() }));
const api = vi.hoisted(() => ({
  fetchNotifications: vi.fn(),
  retryNotification: vi.fn(),
  cancelNotification: vi.fn(),
}));

vi.mock("./api", () => ({ fetchPilotSession: pilotApi.fetchPilotSession }));
vi.mock("./line-notifications-api", () => ({
  fetchNotifications: api.fetchNotifications,
  retryNotification: api.retryNotification,
  cancelNotification: api.cancelNotification,
}));

import { NotificationsOutbox } from "./notifications-outbox";

const ORG = "20000000-0000-4000-8000-000000000001";

function session(role: string) {
  return { user: { id: "u1", email: "o@t.test", displayName: "O" }, memberships: [{ id: "m1", organizationId: ORG, displayName: "O", role, status: "active" }] };
}

function notification(overrides: Record<string, unknown> = {}) {
  return {
    id: "88100000-0000-4000-8000-000000000001",
    channel: "line",
    templateKey: "completed",
    templateVersion: 1,
    status: "failed",
    approvalStatus: "not_required",
    attemptCount: 2,
    maxAttempts: 5,
    lastErrorCode: "RATE_LIMITED",
    hasProviderMessage: false,
    relatedType: "work_order",
    relatedId: null,
    scheduledAt: null,
    nextAttemptAt: null,
    sentAt: null,
    failedAt: null,
    cancelledAt: null,
    createdAt: "2026-07-20T00:00:00+00:00",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  pilotApi.fetchPilotSession.mockResolvedValue(session("dispatcher"));
  api.fetchNotifications.mockResolvedValue({ data: [notification()], meta: { hasMore: false, nextCursor: null } });
  api.retryNotification.mockResolvedValue(undefined);
  api.cancelNotification.mockResolvedValue(undefined);
});

describe("NotificationsOutbox", () => {
  it("lists notifications with a redacted status and lets a manager resend a failed one", async () => {
    render(<NotificationsOutbox />);

    await screen.findByText("完工通知");
    expect(screen.getByText("失敗")).toBeInTheDocument();
    // The raw error code is shown for triage but no provider id / payload.
    expect(screen.getByText("RATE_LIMITED")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "重送" }));
    await waitFor(() => expect(api.retryNotification).toHaveBeenCalledTimes(1));
    expect(api.retryNotification).toHaveBeenCalledWith(ORG, notification().id);
  });

  it("hides the outbox from a technician (permission state, not just a hidden button)", async () => {
    pilotApi.fetchPilotSession.mockResolvedValue(session("technician"));
    render(<NotificationsOutbox />);
    await screen.findByText("你沒有檢視權限");
    expect(api.fetchNotifications).not.toHaveBeenCalled();
  });

  it("shows an empty state when there are no notifications", async () => {
    api.fetchNotifications.mockResolvedValue({ data: [], meta: { hasMore: false, nextCursor: null } });
    render(<NotificationsOutbox />);
    await screen.findByText(/目前沒有任何 LINE 通知紀錄/);
  });

  it("shows an error state when loading fails", async () => {
    api.fetchNotifications.mockRejectedValue(new Error("boom"));
    render(<NotificationsOutbox />);
    await screen.findByText("通知紀錄讀不到");
  });

  it("does not offer resend for a sent notification", async () => {
    api.fetchNotifications.mockResolvedValue({
      data: [notification({ status: "sent", lastErrorCode: null })],
      meta: { hasMore: false, nextCursor: null },
    });
    render(<NotificationsOutbox />);
    await screen.findByText("已送出");
    expect(screen.queryByRole("button", { name: "重送" })).toBeNull();
  });
});

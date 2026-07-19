import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { WorkOrderAssignSheet } from "./work-order-assign-sheet";
import type { OrganizationMember } from "./triage-api";

const organizationId = "20000000-0000-4000-8000-000000000001";
const workOrderId = "82000000-0000-4000-8000-000000000001";

const woApi = vi.hoisted(() => ({
  checkScheduleConflicts: vi.fn(),
}));

vi.mock("./work-order-api", async () => {
  const actual = await vi.importActual<typeof import("./work-order-api")>("./work-order-api");
  return { ...actual, checkScheduleConflicts: woApi.checkScheduleConflicts };
});

const members: OrganizationMember[] = [
  { id: "30000000-0000-4000-8000-000000000003", displayName: "技師 A", role: "technician", status: "active" },
  { id: "30000000-0000-4000-8000-000000000004", displayName: "技師 B", role: "technician", status: "active" },
];

function setup(props: Partial<Parameters<typeof WorkOrderAssignSheet>[0]> = {}) {
  const onSchedule = vi.fn().mockResolvedValue(undefined);
  const onCancel = vi.fn();
  render(
    <WorkOrderAssignSheet
      organizationId={organizationId}
      workOrderId={workOrderId}
      canOverride={false}
      onCancel={onCancel}
      onSchedule={onSchedule}
      loadMembers={async () => members}
      {...props}
    />,
  );
  return { onSchedule, onCancel };
}

async function fillWindowAndRoster() {
  await userEvent.click(screen.getByRole("button", { name: "載入可指派師傅" }));
  await screen.findByText("技師 A");
  const [start, end] = screen.getAllByDisplayValue("");
  await userEvent.type(start, "2026-08-10T09:00");
  await userEvent.type(end, "2026-08-10T11:00");
  await userEvent.click(screen.getByRole("checkbox", { name: /技師 A/ }));
}

describe("WorkOrderAssignSheet", () => {
  afterEach(() => vi.clearAllMocks());

  it("assigns the first selected member as lead", async () => {
    setup();
    await fillWindowAndRoster();
    expect(screen.getByText("主責")).toBeInTheDocument();
  });

  it("schedules with the chosen window and roster when there is no conflict", async () => {
    woApi.checkScheduleConflicts.mockResolvedValue([]);
    const { onSchedule } = setup();
    await fillWindowAndRoster();
    await userEvent.click(screen.getByRole("button", { name: "確認排程" }));

    await waitFor(() => expect(onSchedule).toHaveBeenCalledTimes(1));
    const input = onSchedule.mock.calls[0][0];
    expect(input.assignments).toHaveLength(1);
    expect(input.assignments[0].duty).toBe("lead");
    expect(input.conflictOverrideReason).toBeNull();
  });

  it("blocks a plain dispatcher from overriding a detected conflict", async () => {
    woApi.checkScheduleConflicts.mockResolvedValue([
      {
        membershipId: members[0].id,
        workOrderId: "82000000-0000-4000-8000-000000000009",
        workOrderNo: "W-9",
        startsAt: null,
        endsAt: null,
      },
    ]);
    const { onSchedule } = setup({ canOverride: false });
    await fillWindowAndRoster();
    await userEvent.click(screen.getByRole("button", { name: "檢查衝突" }));
    await screen.findByText("偵測到排程衝突");

    await userEvent.click(screen.getByRole("button", { name: "確認排程" }));
    await waitFor(() =>
      expect(screen.getAllByText(/需要管理者權限才能覆寫/).length).toBeGreaterThan(0),
    );
    expect(onSchedule).not.toHaveBeenCalled();
  });

  it("lets an owner override a conflict with a reason", async () => {
    woApi.checkScheduleConflicts.mockResolvedValue([
      {
        membershipId: members[0].id,
        workOrderId: "82000000-0000-4000-8000-000000000009",
        workOrderNo: "W-9",
        startsAt: null,
        endsAt: null,
      },
    ]);
    const { onSchedule } = setup({ canOverride: true });
    await fillWindowAndRoster();
    await userEvent.click(screen.getByRole("button", { name: "檢查衝突" }));
    await screen.findByText("偵測到排程衝突");

    const reason = screen.getByPlaceholderText(/客戶指定此時段/);
    await userEvent.type(reason, "客戶指定時段，已確認");
    await userEvent.click(screen.getByRole("button", { name: "確認排程" }));

    await waitFor(() => expect(onSchedule).toHaveBeenCalledTimes(1));
    expect(onSchedule.mock.calls[0][0].conflictOverrideReason).toBe("客戶指定時段，已確認");
  });
});

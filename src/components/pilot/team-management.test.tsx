import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TeamManagement, type InviteMember, type LoadMembers } from "./team-management";
import type { OrganizationMember } from "./triage-api";

const organizationId = "20000000-0000-4000-8000-000000000001";

function member(overrides: Partial<OrganizationMember> = {}): OrganizationMember {
  return {
    id: crypto.randomUUID(),
    displayName: "王老闆",
    role: "owner",
    status: "active",
    ...overrides,
  };
}

interface Deps {
  loadMembers: LoadMembers;
  inviteMember: InviteMember;
}

function setup(overrides: Partial<Deps> = {}) {
  const loadMembers: LoadMembers =
    overrides.loadMembers ??
    vi.fn(async () => [
      member({ displayName: "王老闆", role: "owner", status: "active" }),
      member({ displayName: "李技師", role: "technician", status: "active" }),
    ]);
  const inviteMember: InviteMember =
    overrides.inviteMember ?? vi.fn(async () => member());

  render(
    <TeamManagement
      organizationId={organizationId}
      role="owner"
      loadMembers={loadMembers}
      inviteMember={inviteMember}
    />,
  );

  return { loadMembers, inviteMember };
}

afterEach(() => vi.clearAllMocks());

describe("TeamManagement", () => {
  it("shows a loading state then lists members with role and status badges", async () => {
    setup();

    expect(screen.getByRole("status", { name: "正在載入成員" })).toBeInTheDocument();

    const list = await screen.findByRole("list", { name: "成員清單" });
    const rows = within(list).getAllByRole("listitem");
    expect(rows).toHaveLength(2);
    expect(within(rows[0]).getByText("王老闆")).toBeInTheDocument();
    expect(within(rows[0]).getByText("負責人")).toBeInTheDocument();
    expect(within(rows[1]).getByText("李技師")).toBeInTheDocument();
    expect(within(rows[1]).getByText("技師")).toBeInTheDocument();
  });

  it("renders an empty state when there are no members", async () => {
    setup({ loadMembers: vi.fn().mockResolvedValue([]) });

    expect(await screen.findByText(/還沒有其他成員/)).toBeInTheDocument();
  });

  it("shows an error state and retries the load", async () => {
    const loadMembers = vi
      .fn()
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce([member({ displayName: "王老闆" })]);
    setup({ loadMembers });

    expect(await screen.findByRole("alert")).toHaveTextContent(/讀不到/);
    await userEvent.click(screen.getByRole("button", { name: "重新載入" }));

    await screen.findByText("王老闆");
    expect(loadMembers).toHaveBeenCalledTimes(2);
  });

  it("adds a technician and refetches the list on success", async () => {
    const added = member({
      displayName: "陳師傅",
      role: "technician",
      status: "active",
    });
    const loadMembers = vi
      .fn()
      .mockResolvedValueOnce([member({ displayName: "王老闆" })])
      .mockResolvedValueOnce([member({ displayName: "王老闆" }), added]);
    const inviteMember = vi.fn().mockResolvedValue(added);
    setup({ loadMembers, inviteMember });

    await screen.findByText("王老闆");

    await userEvent.type(screen.getByLabelText("姓名"), "陳師傅");
    await userEvent.type(screen.getByLabelText("Email"), "chen@example.test");
    await userEvent.click(screen.getByRole("button", { name: "新增技師" }));

    await waitFor(() =>
      expect(inviteMember).toHaveBeenCalledWith(organizationId, {
        displayName: "陳師傅",
        email: "chen@example.test",
        role: "technician",
      }),
    );

    expect(await screen.findByRole("status", { name: "新增結果" })).toHaveTextContent(
      /已新增/,
    );
    expect(loadMembers).toHaveBeenCalledTimes(2);
    await screen.findByText("陳師傅");
  });

  it("surfaces an invite failure without clearing the form", async () => {
    const inviteMember = vi.fn().mockRejectedValue(new Error("該 Email 已是成員"));
    setup({ inviteMember });

    await screen.findByText("王老闆");
    await userEvent.type(screen.getByLabelText("姓名"), "陳師傅");
    await userEvent.type(screen.getByLabelText("Email"), "chen@example.test");
    await userEvent.click(screen.getByRole("button", { name: "新增技師" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("該 Email 已是成員");
    expect(screen.getByLabelText("姓名")).toHaveValue("陳師傅");
  });

  it("blocks submit when required fields are empty", async () => {
    const inviteMember = vi.fn();
    setup({ inviteMember });

    await screen.findByText("王老闆");
    await userEvent.click(screen.getByRole("button", { name: "新增技師" }));

    expect(inviteMember).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(/姓名與 Email/);
  });

  it("hides the add form and shows a notice for non-manager roles", async () => {
    render(
      <TeamManagement
        organizationId={organizationId}
        role="technician"
        loadMembers={vi.fn().mockResolvedValue([])}
        inviteMember={vi.fn()}
      />,
    );

    expect(await screen.findByText(/沒有成員管理權限/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "新增技師" })).not.toBeInTheDocument();
  });
});

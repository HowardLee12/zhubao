import { render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PilotBottomNav } from "./pilot-bottom-nav";

const pathname = vi.hoisted(() => ({ value: "/app" }));

vi.mock("next/navigation", () => ({
  usePathname: () => pathname.value,
}));

afterEach(() => {
  pathname.value = "/app";
});

function tabLabels(): string[] {
  const nav = screen.getByRole("navigation", { name: "主導覽" });
  return within(nav)
    .getAllByRole("link")
    .map((link) => link.textContent?.trim() ?? "");
}

describe("PilotBottomNav", () => {
  it("renders the manager tab set for an owner", () => {
    render(<PilotBottomNav role="owner" />);
    expect(tabLabels()).toEqual(["工作台", "接案匣", "排程", "收款", "回訪", "設定"]);
  });

  it("renders the manager tab set for a dispatcher", () => {
    render(<PilotBottomNav role="dispatcher" />);
    expect(tabLabels()).toEqual(["工作台", "接案匣", "排程", "收款", "回訪", "設定"]);
  });

  it("renders the technician tab set", () => {
    render(<PilotBottomNav role="technician" />);
    expect(tabLabels()).toEqual(["今日", "我的工單"]);
  });

  it("points manager tabs at their routes", () => {
    render(<PilotBottomNav role="admin" />);
    const nav = screen.getByRole("navigation", { name: "主導覽" });
    const hrefs = within(nav)
      .getAllByRole("link")
      .map((link) => link.getAttribute("href"));
    expect(hrefs).toEqual([
      "/app",
      "/app/inbox",
      "/app/schedule",
      "/app/payments",
      "/app/follow-ups",
      "/app/settings",
    ]);
  });

  it("points technician tabs at their routes", () => {
    render(<PilotBottomNav role="technician" />);
    const nav = screen.getByRole("navigation", { name: "主導覽" });
    const hrefs = within(nav)
      .getAllByRole("link")
      .map((link) => link.getAttribute("href"));
    expect(hrefs).toEqual(["/app/today", "/app/my-work-orders"]);
  });

  it("marks the active tab with aria-current on an exact path match", () => {
    pathname.value = "/app/inbox";
    render(<PilotBottomNav role="owner" />);
    const current = screen.getByRole("link", { current: "page" });
    expect(current).toHaveTextContent("接案匣");
  });

  it("marks a parent tab active for a nested detail path", () => {
    pathname.value = "/app/inbox/abc-123";
    render(<PilotBottomNav role="owner" />);
    const current = screen.getByRole("link", { current: "page" });
    expect(current).toHaveTextContent("接案匣");
  });

  it("activates 收款 on a nested payments route", () => {
    pathname.value = "/app/payments";
    render(<PilotBottomNav role="dispatcher" />);
    const current = screen.getByRole("link", { current: "page" });
    expect(current).toHaveTextContent("收款");
  });

  it("activates 回訪 on the follow-ups surface", () => {
    pathname.value = "/app/follow-ups";
    render(<PilotBottomNav role="owner" />);
    const current = screen.getByRole("link", { current: "page" });
    expect(current).toHaveTextContent("回訪");
  });

  it("keeps 工作台 exact so it is not active on nested manager routes", () => {
    pathname.value = "/app/schedule";
    render(<PilotBottomNav role="owner" />);
    const current = screen.getByRole("link", { current: "page" });
    expect(current).toHaveTextContent("排程");
  });
});

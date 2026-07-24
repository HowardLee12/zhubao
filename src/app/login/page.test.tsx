import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/components/pilot-auth/login-form", () => ({
  LoginForm: ({ next }: { next?: string }) => (
    <div data-testid="login-form" data-next={next ?? ""} />
  ),
}));

import LoginPage from "./page";

describe("LoginPage", () => {
  it("explains employee login without implying customers need accounts", async () => {
    render(
      await LoginPage({
        searchParams: Promise.resolve({}),
      }),
    );

    expect(screen.getByRole("heading", { name: "登入開始接案" })).toBeVisible();
    expect(screen.getByText(/客戶填報修時不需要登入/)).toBeVisible();
    expect(screen.getByTestId("login-form")).toBeVisible();
  });

  it("shows a generic recovery message after a failed callback", async () => {
    render(
      await LoginPage({
        searchParams: Promise.resolve({ error: "auth_callback" }),
      }),
    );

    expect(screen.getByRole("alert")).toHaveTextContent(
      "登入連結無效或已過期，請重新寄送一封。",
    );
  });

  it("passes the requested next path through to the login form", async () => {
    render(
      await LoginPage({
        searchParams: Promise.resolve({ next: "/app/inbox" }),
      }),
    );

    expect(screen.getByTestId("login-form")).toHaveAttribute(
      "data-next",
      "/app/inbox",
    );
  });

  it("ignores an array-form next param", async () => {
    render(
      await LoginPage({
        searchParams: Promise.resolve({ next: ["/app", "/evil"] }),
      }),
    );

    expect(screen.getByTestId("login-form")).toHaveAttribute("data-next", "");
  });
});

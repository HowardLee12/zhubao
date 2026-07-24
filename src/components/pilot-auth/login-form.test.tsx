import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/app/login/actions", () => ({
  requestMagicLink: vi.fn(),
}));

import { LoginForm } from "./login-form";

describe("LoginForm", () => {
  it("provides an accessible passwordless email sign-in form", () => {
    render(<LoginForm />);

    expect(screen.getByLabelText("工作信箱")).toHaveAttribute("type", "email");
    expect(
      screen.getByRole("button", { name: "寄送登入連結" }),
    ).toBeEnabled();
    expect(screen.getByRole("paragraph")).toHaveAttribute(
      "aria-live",
      "polite",
    );
  });

  it("carries the requested next path as a hidden field for the server action", () => {
    const { container } = render(<LoginForm next="/app/inbox?tab=new" />);

    const hidden = container.querySelector('input[name="next"]');
    expect(hidden).toHaveAttribute("type", "hidden");
    expect(hidden).toHaveValue("/app/inbox?tab=new");
  });

  it("omits the next field when no deep link was requested", () => {
    const { container } = render(<LoginForm />);

    expect(container.querySelector('input[name="next"]')).toBeNull();
  });
});

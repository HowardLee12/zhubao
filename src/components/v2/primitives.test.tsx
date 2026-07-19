import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { V2Icon, type V2IconName } from "./icons";
import {
  DemoAvatar,
  DemoNotice,
  MetaRow,
  SectionHeading,
  StatusBadge,
  V2Button,
  V2Card,
  V2IconButton,
  formatDemoMoney,
} from "./primitives";

const iconNames: V2IconName[] = [
  "alert", "arrow", "briefcase", "calendar", "camera", "check", "chevron",
  "clock", "cloud", "file", "image", "inbox", "line", "location", "lock",
  "phone", "plus", "quote", "refresh", "route", "send", "shield", "sparkles",
  "user", "wrench",
];

describe("v2 presentation primitives", () => {
  it("renders every local icon without relying on an external asset", () => {
    const { container } = render(
      <div>{iconNames.map((name) => <V2Icon key={name} name={name} data-name={name} />)}</div>,
    );

    expect(container.querySelectorAll("svg")).toHaveLength(iconNames.length);
    expect(container.querySelector('[data-name="shield"]')).toBeInTheDocument();
  });

  it("covers button, badge and avatar variants", () => {
    const onClick = vi.fn();
    render(
      <V2Card>
        {(["primary", "secondary", "quiet", "danger"] as const).map((variant) => (
          <V2Button key={variant} variant={variant} icon={variant === "primary" ? "check" : undefined} onClick={onClick}>
            {variant}
          </V2Button>
        ))}
        <V2IconButton label="新增" icon="plus" />
        {(["neutral", "orange", "blue", "green", "red", "purple"] as const).map((tone) => (
          <StatusBadge key={tone} tone={tone}>{tone}</StatusBadge>
        ))}
        <DemoAvatar initial="小" size="sm" tone="orange" />
        <DemoAvatar initial="中" size="md" tone="ink" />
        <DemoAvatar initial="大" size="lg" tone="green" />
      </V2Card>,
    );

    expect(screen.getByRole("button", { name: "新增" })).toBeInTheDocument();
    expect(screen.getByText("purple")).toBeInTheDocument();
  });

  it("renders optional heading, metadata and all notice tones", () => {
    render(
      <div>
        <SectionHeading eyebrow="Context" title="標題" description="說明" right={<span>右側</span>} />
        <SectionHeading title="只有標題" />
        <MetaRow icon="location">台北市</MetaRow>
        <DemoNotice notice={{ tone: "success", message: "成功" }} />
        <DemoNotice notice={{ tone: "danger", message: "失敗" }} />
        <DemoNotice notice={{ tone: "info", message: "資訊" }} />
      </div>,
    );

    expect(screen.getByText("Context")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("失敗");
    expect(screen.getAllByRole("status")).toHaveLength(2);
    expect(formatDemoMoney(123456)).toBe("NT$ 123,456");
  });
});

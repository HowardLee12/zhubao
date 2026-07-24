import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ForceCompleteSheet } from "./force-complete-sheet";

describe("ForceCompleteSheet", () => {
  it("labels itself as an exception completion, not a customer sign-off", () => {
    render(<ForceCompleteSheet onCancel={vi.fn()} onForceComplete={vi.fn()} />);
    expect(screen.getByText(/例外完工，非客戶簽認/)).toBeInTheDocument();
  });

  it("requires a reason before submitting", async () => {
    const onForceComplete = vi.fn().mockResolvedValue(undefined);
    render(<ForceCompleteSheet onCancel={vi.fn()} onForceComplete={onForceComplete} />);

    await userEvent.click(screen.getByRole("button", { name: "確認例外完工" }));
    expect(screen.getByText("請填寫例外完工原因。")).toBeInTheDocument();
    expect(onForceComplete).not.toHaveBeenCalled();
  });

  it("requires a completion summary before submitting", async () => {
    const onForceComplete = vi.fn().mockResolvedValue(undefined);
    render(<ForceCompleteSheet onCancel={vi.fn()} onForceComplete={onForceComplete} />);

    await userEvent.type(
      screen.getByPlaceholderText(/客戶臨時外出/),
      "客戶不在場",
    );
    await userEvent.click(screen.getByRole("button", { name: "確認例外完工" }));
    expect(screen.getByText("請填寫完工摘要。")).toBeInTheDocument();
    expect(onForceComplete).not.toHaveBeenCalled();
  });

  it("submits the reason and summary when both are filled", async () => {
    const onForceComplete = vi.fn().mockResolvedValue(undefined);
    render(<ForceCompleteSheet onCancel={vi.fn()} onForceComplete={onForceComplete} />);

    await userEvent.type(screen.getByPlaceholderText(/客戶臨時外出/), "客戶不在場，由管委代確認");
    await userEvent.type(screen.getByPlaceholderText(/簡述實際完成/), "已完成清洗");
    await userEvent.click(screen.getByRole("button", { name: "確認例外完工" }));

    expect(onForceComplete).toHaveBeenCalledWith({
      reason: "客戶不在場，由管委代確認",
      completionSummary: "已完成清洗",
    });
  });
});

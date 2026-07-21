import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ChecklistItemInput, PhotoCaptureButton } from "./technician-task-inputs";
import type { ChecklistItem } from "./work-order-api";

function item(overrides: Partial<ChecklistItem> = {}): ChecklistItem {
  return {
    id: "item-1",
    label: "確認運轉正常",
    responseType: "boolean",
    isRequired: true,
    evidenceRequired: false,
    options: null,
    response: null,
    completedAt: null,
    completedByMembershipId: null,
    sortOrder: 1,
    ...overrides,
  };
}

describe("ChecklistItemInput", () => {
  it("responds true/false for a boolean item", async () => {
    const onRespond = vi.fn();
    render(
      <ChecklistItemInput item={item()} disabled={false} onRespond={onRespond} onCapture={vi.fn()} />,
    );
    await userEvent.click(screen.getByRole("button", { name: "是" }));
    expect(onRespond).toHaveBeenCalledWith(true);
    await userEvent.click(screen.getByRole("button", { name: "否" }));
    expect(onRespond).toHaveBeenCalledWith(false);
  });

  it("coerces a number response to a number", async () => {
    const onRespond = vi.fn();
    render(
      <ChecklistItemInput
        item={item({ responseType: "number" })}
        disabled={false}
        onRespond={onRespond}
        onCapture={vi.fn()}
      />,
    );
    await userEvent.type(screen.getByPlaceholderText("輸入作答內容"), "42");
    await userEvent.click(screen.getByRole("button", { name: "儲存" }));
    expect(onRespond).toHaveBeenCalledWith(42);
  });

  it("shows an evidence-photo capture for a boolean item that also requires evidence", async () => {
    // The completion gate needs BOTH the 是/否 answer AND a supporting photo; without
    // the evidence tile a required boolean item would be unsatisfiable (the deadlock
    // a technician hit in the field).
    const onRespond = vi.fn();
    const onCapture = vi.fn();
    render(
      <ChecklistItemInput
        item={item({ responseType: "boolean", evidenceRequired: true })}
        disabled={false}
        onRespond={onRespond}
        onCapture={onCapture}
      />,
    );
    // Answer input is present…
    expect(screen.getByRole("button", { name: "是" })).toBeInTheDocument();
    // …and so is the evidence capture, which uploads via onCapture.
    const file = new File([new Uint8Array([1])], "e.jpg", { type: "image/jpeg" });
    await userEvent.upload(screen.getByLabelText(/佐證/), file);
    expect(onCapture).toHaveBeenCalledWith(file);
  });

  it("does not show an evidence capture for a boolean item without evidenceRequired", () => {
    render(
      <ChecklistItemInput
        item={item({ responseType: "boolean", evidenceRequired: false })}
        disabled={false}
        onRespond={vi.fn()}
        onCapture={vi.fn()}
      />,
    );
    expect(screen.queryByLabelText(/佐證/)).toBeNull();
  });

  it("captures a file for a photo response type", async () => {
    const onCapture = vi.fn();
    render(
      <ChecklistItemInput
        item={item({ responseType: "photo" })}
        disabled={false}
        onRespond={vi.fn()}
        onCapture={onCapture}
      />,
    );
    const file = new File([new Uint8Array([1])], "x.jpg", { type: "image/jpeg" });
    await userEvent.upload(screen.getByLabelText(/上傳/), file);
    expect(onCapture).toHaveBeenCalledWith(file);
  });

  it("serializes a multi_choice item as the JSON array the RPC requires", async () => {
    const onRespond = vi.fn();
    render(
      <ChecklistItemInput
        item={item({
          responseType: "multi_choice",
          label: "已更換耗材",
          options: ["濾網", "壓縮機", "排水管"],
        })}
        disabled={false}
        onRespond={onRespond}
        onCapture={vi.fn()}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "濾網" }));
    await userEvent.click(screen.getByRole("button", { name: "排水管" }));
    await userEvent.click(screen.getByRole("button", { name: "儲存" }));
    expect(onRespond).toHaveBeenCalledTimes(1);
    expect(onRespond).toHaveBeenCalledWith(["濾網", "排水管"]);
  });

  it("toggles a multi_choice option off when re-selected", async () => {
    const onRespond = vi.fn();
    render(
      <ChecklistItemInput
        item={item({
          responseType: "multi_choice",
          label: "已更換耗材",
          options: ["濾網", "壓縮機"],
        })}
        disabled={false}
        onRespond={onRespond}
        onCapture={vi.fn()}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "濾網" }));
    await userEvent.click(screen.getByRole("button", { name: "壓縮機" }));
    await userEvent.click(screen.getByRole("button", { name: "濾網" }));
    await userEvent.click(screen.getByRole("button", { name: "儲存" }));
    expect(onRespond).toHaveBeenCalledWith(["壓縮機"]);
  });

  it("serializes a single_choice item as the bare string the RPC requires", async () => {
    const onRespond = vi.fn();
    render(
      <ChecklistItemInput
        item={item({
          responseType: "single_choice",
          label: "冷媒種類",
          options: ["R32", "R410A"],
        })}
        disabled={false}
        onRespond={onRespond}
        onCapture={vi.fn()}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "R410A" }));
    await userEvent.click(screen.getByRole("button", { name: "儲存" }));
    expect(onRespond).toHaveBeenCalledTimes(1);
    // single_choice must send a bare string (jsonb 'string'), never an array.
    expect(onRespond).toHaveBeenCalledWith("R410A");
  });
});

describe("PhotoCaptureButton", () => {
  it("shows the ready count and forwards the selected file", async () => {
    const onSelect = vi.fn();
    render(<PhotoCaptureButton label="施工前" count={2} disabled={false} onSelect={onSelect} />);
    expect(screen.getByText("已 2 張")).toBeInTheDocument();
    const file = new File([new Uint8Array([1])], "b.jpg", { type: "image/jpeg" });
    // The file input is hidden inside the label tile.
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    await userEvent.upload(fileInput, file);
    expect(onSelect).toHaveBeenCalledWith(file);
  });
});

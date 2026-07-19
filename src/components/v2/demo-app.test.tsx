import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, describe, expect, it } from "vitest";

import { DemoApp } from "./demo-app";

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => values.delete(key),
    setItem: (key, value) => values.set(key, value),
  };
}

beforeAll(() => {
  if (typeof window.localStorage.clear !== "function") {
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: memoryStorage(),
    });
  }
  if (typeof window.sessionStorage.clear !== "function") {
    Object.defineProperty(window, "sessionStorage", {
      configurable: true,
      value: memoryStorage(),
    });
  }
});

describe("DemoApp", () => {
  it("moves from the inbox to a case and requires quote confirmation", async () => {
    const user = userEvent.setup();
    render(<DemoApp />);

    expect(screen.getByText("互動原型 · 示範資料")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "接案匣" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "整理這筆進件" }));
    expect(screen.getByRole("heading", { name: /林太太/ })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "建立報價" }));
    expect(screen.getByRole("heading", { name: "報價人工確認" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "核准並送出報價" }));
    expect(screen.getByText(/請先勾選人工確認/)).toBeInTheDocument();

    await user.click(screen.getByRole("checkbox", { name: /我已檢查/ }));
    await user.click(screen.getByRole("button", { name: "核准並送出報價" }));
    expect(screen.getByText("等待客戶確認")).toBeInTheDocument();
  });

  it("can preview loading, empty and error states without losing demo data", async () => {
    const user = userEvent.setup();
    render(<DemoApp />);

    await user.selectOptions(screen.getByLabelText("預覽畫面狀態"), "loading");
    expect(screen.getByLabelText("示範內容載入中")).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText("預覽畫面狀態"), "empty");
    expect(screen.getByRole("heading", { name: "目前沒有待處理進件" })).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText("預覽畫面狀態"), "error");
    expect(screen.getByRole("heading", { name: "這個區塊暫時讀不到" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "重試載入" }));
    expect(screen.getByRole("heading", { name: "接案匣" })).toBeInTheDocument();
  });

  it("switches to the small-project fixture from the mobile template control", async () => {
    const user = userEvent.setup();
    render(<DemoApp />);

    const templateControls = screen.getAllByRole("group", {
      name: "選擇示範模板",
    });
    const mobileTemplateControl = templateControls.at(-1);

    expect(mobileTemplateControl).toBeDefined();
    await user.click(
      within(mobileTemplateControl as HTMLElement).getByRole("button", {
        name: "小型工程",
      }),
    );

    expect(screen.getByText("陽台漏水與防水修繕")).toBeInTheDocument();
    expect(screen.getByText("抓漏・防水")).toBeInTheDocument();
  });
});

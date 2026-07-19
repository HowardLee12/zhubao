import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { DemoApp } from "./demo-app";

async function acceptQuote(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "整理這筆進件" }));
  await user.click(screen.getByRole("button", { name: "建立報價" }));

  await user.click(screen.getByRole("tab", { name: "客戶看到的版本" }));
  expect(screen.getByText("客戶版不載入成本、毛利與內部備註")).toBeInTheDocument();
  expect(screen.queryByText(/內部成本/)).not.toBeInTheDocument();

  await user.click(screen.getByRole("checkbox", { name: /我已檢查/ }));
  await user.click(screen.getByRole("button", { name: "核准並送出報價" }));
  await user.click(screen.getByRole("button", { name: "模擬客戶接受" }));
}

async function completeServiceWorkOrder(user: ReturnType<typeof userEvent.setup>) {
  await acceptQuote(user);

  await user.click(screen.getByRole("radio", { name: /李師傅/ }));
  expect(screen.getByRole("alert")).toHaveTextContent("已有工單");
  await user.click(screen.getByRole("button", { name: "確認派工並切換技師模式" }));
  expect(screen.getByText("這個時段已有工單，請改派或調整時間。")).toBeInTheDocument();

  await user.click(screen.getByRole("radio", { name: /陳師傅/ }));
  await user.click(screen.getByRole("button", { name: "確認派工並切換技師模式" }));

  for (const action of ["開始出發", "我已到場", "開始施工", "送出待確認"]) {
    await user.click(screen.getByRole("button", { name: action }));
  }

  await user.click(screen.getByRole("button", { name: "確認完工" }));
  expect(screen.getByRole("alert")).toHaveTextContent("還缺 5 項完工紀錄");

  const checklist = screen.getByRole("group", { name: "必要現場檢查項目" });
  for (const checkbox of within(checklist).getAllByRole("checkbox")) {
    await user.click(checkbox);
  }
  await user.click(screen.getByRole("button", { name: "加入施工前示範照" }));
  await user.click(screen.getByRole("button", { name: "加入施工後示範照" }));
  expect(screen.getByText("必要紀錄已齊全，可以安全完工")).toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "確認完工" }));
}

// These end-to-end workflow drives (many userEvent clicks) run comfortably
// under the default 5s timeout in a normal run, but v8 coverage instrumentation
// slows every interaction enough to intermittently exceed it. Give the whole
// suite explicit headroom so `test:coverage` is deterministic.
describe("DemoApp complete workflows", { timeout: 30_000 }, () => {
  it("blocks scheduling conflicts and completes the service evidence flow", async () => {
    const user = userEvent.setup();
    render(<DemoApp />);

    await completeServiceWorkOrder(user);

    expect(screen.getByRole("heading", { name: "完工摘要" })).toBeInTheDocument();
    expect(screen.getByText("已安全完成")).toBeInTheDocument();
    expect(screen.getByText("3/3")).toBeInTheDocument();
    expect(screen.getByText("證據照片").parentElement).toHaveTextContent("2證據照片");

    await user.click(screen.getByRole("button", { name: "回案件查看" }));
    expect(screen.getByRole("heading", { name: /林太太/ })).toBeInTheDocument();
  });

  it("shows precondition screens before quote acceptance and dispatch", async () => {
    const user = userEvent.setup();
    render(<DemoApp />);

    await user.click(screen.getByRole("button", { name: /技師模式/ }));
    expect(screen.getByRole("heading", { name: "今日任務" })).toBeInTheDocument();
    expect(screen.getByText("這張工單還沒派工")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "回到派工" }));
    expect(screen.getByText("還不能派工")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "回到報價確認" }));
    expect(screen.getByRole("heading", { name: "報價人工確認" })).toBeInTheDocument();

    await user.click(screen.getAllByRole("button", { name: /完工$/ })[0]);
    expect(screen.getByText("尚未完成這張工單")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "回到技師現場" }));
    expect(screen.getByRole("heading", { name: "今日任務" })).toBeInTheDocument();
  });

  it("locks and accepts a project change order", async () => {
    const user = userEvent.setup();
    render(<DemoApp />);

    await user.click(screen.getAllByRole("button", { name: "小型工程" })[0]);
    await user.click(screen.getByRole("button", { name: "整理這筆進件" }));
    await user.click(screen.getByRole("button", { name: "送出追加簽認" }));

    expect(screen.getByText("此版本已鎖定，正在等待客戶回覆")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "模擬客戶接受追加" }));
    expect(screen.getByText("簽認版本、時間與證據已保留")).toBeInTheDocument();
    expect(screen.getByText("NT$ 76,000")).toBeInTheDocument();
  });

  it("can revisit the accepted quote and the completed technician view", async () => {
    const user = userEvent.setup();
    render(<DemoApp />);

    await completeServiceWorkOrder(user);
    await user.click(screen.getAllByRole("button", { name: "現場" })[0]);
    expect(screen.getByText("這張工單已安全完成")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "查看完工摘要" }));

    await user.click(screen.getAllByRole("button", { name: "報價" })[0]);
    expect(screen.getByText(/客戶已接受 v1/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "前往派工" }));
    expect(screen.getByRole("heading", { name: "安排工單" })).toBeInTheDocument();
  });
});

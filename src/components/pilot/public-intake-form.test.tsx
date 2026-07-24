import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { normalizeTaiwanPhone, PublicIntakeForm } from "./public-intake-form";

const token = "public-intake-token";
const config = {
  submissionId: "91000000-0000-4000-8000-000000000001",
  merchantName: "安心工程",
  headline: "到府維修與工程需求",
  serviceCatalogItems: [
    {
      id: "71100000-0000-4000-8000-000000000001",
      name: "分離式冷氣清洗",
      category: "冷氣",
    },
  ],
  photoLimit: 3,
  acceptedPhotoTypes: ["image/jpeg", "image/png", "image/webp"],
  privacyNotice: "資料只用於本次聯絡、估價與服務安排。",
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("PublicIntakeForm", () => {
  beforeEach(() => {
    let sequence = 0;
    vi.stubGlobal("crypto", {
      randomUUID: vi.fn(() => `request-key-${++sequence}`),
      subtle: {
        digest: vi.fn(async () => new Uint8Array(32).fill(0xab).buffer),
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("loads merchant configuration without asking the customer to register", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ data: config }));
    vi.stubGlobal("fetch", fetchMock);

    render(<PublicIntakeForm token={token} />);

    expect(screen.getByRole("status", { name: "正在載入報修表單" })).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "到府維修與工程需求" })).toBeInTheDocument();
    expect(screen.getByText("安心工程")).toBeInTheDocument();
    expect(screen.getByText("不用註冊帳號，送出後店家會直接與你聯絡。")).toBeInTheDocument();
    expect(screen.getByLabelText("聯絡人姓名")).toHaveAttribute("maxlength", "120");
    expect(screen.getByLabelText("需求標題")).toHaveAttribute("maxlength", "160");
    expect(screen.getByLabelText("問題與需求說明")).toHaveAttribute("maxlength", "10000");
    expect(screen.getByLabelText("服務地址")).toHaveAttribute("maxlength", "300");
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/v2/public/intake/${token}`,
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("normalizes the same E.164 and Taiwan local phone formats accepted by the API", () => {
    expect(normalizeTaiwanPhone("02-2345-6789")).toBe("+886223456789");
    expect(normalizeTaiwanPhone("0912 345 678")).toBe("+886912345678");
    expect(normalizeTaiwanPhone("+886.912.345.678")).toBe("+886912345678");
    expect(normalizeTaiwanPhone("886912345678")).toBeNull();
  });

  it("uploads selected photos, submits the structured request and shows its reference", async () => {
    const photoId = "90000000-0000-4000-8000-000000000001";
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ data: config }))
      .mockResolvedValueOnce(
        jsonResponse(
          {
            data: {
              photoId,
              upload: {
                method: "PUT",
                url: "https://storage.example.test/signed-upload",
                headers: { "x-upsert": "false" },
                expiresAt: "2026-07-16T03:00:00.000Z",
              },
            },
          },
          201,
        ),
      )
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockResolvedValueOnce(jsonResponse({ data: { id: photoId, status: "processing" } }, 202))
      .mockResolvedValueOnce(
        jsonResponse(
          {
            data: {
              referenceNo: "R-2026-0012",
              receivedAt: "2026-07-16T02:00:00.000Z",
              message: "安心工程會盡快與你聯絡。",
            },
          },
          202,
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    render(<PublicIntakeForm token={token} />);
    const user = userEvent.setup();
    await screen.findByRole("form", { name: "報修需求" });

    await user.type(screen.getByLabelText("聯絡人姓名"), "林太太");
    await user.type(screen.getByLabelText("手機號碼"), "0912345678");
    await user.selectOptions(
      screen.getByLabelText("服務項目"),
      "71100000-0000-4000-8000-000000000001",
    );
    await user.type(screen.getByLabelText("需求標題"), "兩台冷氣有異味");
    await user.type(screen.getByLabelText("問題與需求說明"), "希望週六上午到府清洗");
    await user.type(screen.getByLabelText("服務地址"), "台北市松山區民生東路四段 88 號");
    await user.type(screen.getByLabelText("希望開始時間（選填）"), "2026-07-18T09:00");
    await user.type(screen.getByLabelText("希望結束時間（選填）"), "2026-07-18T12:00");
    const photo = new File([new Uint8Array([1, 2, 3])], "aircon.jpg", {
      type: "image/jpeg",
    });
    await user.upload(screen.getByLabelText("現況照片（最多 3 張，選填）"), photo);
    await user.click(screen.getByRole("checkbox", { name: /我已閱讀並同意/ }));
    await user.click(screen.getByRole("button", { name: "送出需求" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(5));
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      `/api/v2/public/intake/${token}/photo-uploads`,
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          submissionId: "91000000-0000-4000-8000-000000000001",
          filename: "aircon.jpg",
          contentType: "image/jpeg",
          byteSize: 3,
          sha256: "ab".repeat(32),
        }),
      }),
    );
    const uploadCall = fetchMock.mock.calls[2] as [string, RequestInit];
    expect(uploadCall[0]).toBe("https://storage.example.test/signed-upload");
    expect(uploadCall[1]).toEqual(
      expect.objectContaining({
        method: "PUT",
        headers: { "x-upsert": "false" },
        body: expect.any(FormData),
      }),
    );
    const uploadBody = uploadCall[1].body as FormData;
    expect(uploadBody.get("cacheControl")).toBe("3600");
    expect(uploadBody.get("")).toBe(photo);
    expect(fetchMock).toHaveBeenNthCalledWith(
      4,
      `/api/v2/public/intake/${token}/photos/${photoId}/complete`,
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ submissionId: "91000000-0000-4000-8000-000000000001" }),
      }),
    );

    const submitCall = fetchMock.mock.calls[4] as [string, RequestInit];
    expect(submitCall[0]).toBe(`/api/v2/public/intake/${token}/service-requests`);
    expect(submitCall[1]).toEqual(
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ "Idempotency-Key": expect.any(String) }),
      }),
    );
    expect(JSON.parse(String(submitCall[1].body))).toMatchObject({
      contactName: "林太太",
      submissionId: "91000000-0000-4000-8000-000000000001",
      contactPhone: "+886912345678",
      serviceCatalogItemId: "71100000-0000-4000-8000-000000000001",
      title: "兩台冷氣有異味",
      description: "希望週六上午到府清洗",
      address: { addressLine: "台北市松山區民生東路四段 88 號" },
      photoIds: [photoId],
      privacyAccepted: true,
      companyWebsite: "",
    });
    expect(JSON.parse(String(submitCall[1].body)).preferredWindows).toEqual([
      expect.objectContaining({ preferenceRank: 1 }),
    ]);

    expect(await screen.findByRole("heading", { name: "需求已送出" })).toBeInTheDocument();
    expect(screen.getByText("R-2026-0012")).toBeInTheDocument();
    expect(screen.getByText("安心工程會盡快與你聯絡。")).toBeInTheDocument();
  });

  it("rejects unsupported or excessive photos before any upload starts", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ data: config }));
    vi.stubGlobal("fetch", fetchMock);
    render(<PublicIntakeForm token={token} />);
    const user = userEvent.setup({ applyAccept: false });
    const input = await screen.findByLabelText("現況照片（最多 3 張，選填）");

    await user.upload(input, new File(["text"], "notes.txt", { type: "text/plain" }));
    expect(screen.getByRole("alert")).toHaveTextContent("只支援 JPG、PNG 或 WebP");

    const photos = [1, 2, 3, 4].map(
      (index) => new File([String(index)], `photo-${index}.jpg`, { type: "image/jpeg" }),
    );
    await user.upload(input, photos);
    expect(screen.getByRole("alert")).toHaveTextContent("最多只能選 3 張照片");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("requires privacy consent and keeps the anti-bot honeypot out of normal navigation", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ data: config })));
    const { container } = render(<PublicIntakeForm token={token} />);
    const user = userEvent.setup();
    await screen.findByRole("form", { name: "報修需求" });

    await user.type(screen.getByLabelText("聯絡人姓名"), "林太太");
    await user.type(screen.getByLabelText("手機號碼"), "0912345678");
    await user.selectOptions(
      screen.getByLabelText("服務項目"),
      "71100000-0000-4000-8000-000000000001",
    );
    await user.type(screen.getByLabelText("需求標題"), "冷氣清洗");
    await user.type(screen.getByLabelText("問題與需求說明"), "冷氣有異味需要清洗");
    await user.type(screen.getByLabelText("服務地址"), "台北市松山區民生東路四段 88 號");

    fireEvent.submit(screen.getByRole("form", { name: "報修需求" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("請先同意個資蒐集說明");

    const honeypot = container.querySelector<HTMLInputElement>('input[name="companyWebsite"]');
    expect(honeypot).toHaveValue("");
    expect(honeypot).toHaveAttribute("tabindex", "-1");
  });

  it("shows a recoverable configuration error", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ title: "連結無法使用" }, 404))
      .mockResolvedValueOnce(jsonResponse({ data: config }));
    vi.stubGlobal("fetch", fetchMock);
    render(<PublicIntakeForm token={token} />);

    expect(await screen.findByRole("alert")).toHaveTextContent("這份報修表單目前無法開啟");
    await userEvent.click(screen.getByRole("button", { name: "重新載入" }));

    expect(await screen.findByRole("heading", { name: "到府維修與工程需求" })).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

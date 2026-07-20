import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PilotIntakeDraftReview } from "./intake-draft-review";

const organizationId = "20000000-0000-4000-8000-000000000001";
const draftId = "90000000-0000-4000-8000-000000000001";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function sessionResponse(role = "owner"): Response {
  return jsonResponse({
    data: {
      user: { id: "10000000-0000-4000-8000-000000000001", email: "o@x.test", displayName: "王老闆" },
      memberships: [
        {
          id: "30000000-0000-4000-8000-000000000001",
          organizationId,
          role,
          status: "active",
          displayName: "王老闆",
        },
      ],
    },
  });
}

function aiDraftDetail(overrides: Record<string, unknown> = {}) {
  return {
    id: draftId,
    conversationId: "a0000000-0000-4000-8000-000000000001",
    status: "pending_review",
    origin: "ai",
    source: "line",
    title: "LINE 進件（AI 摘要）",
    summary: "冷氣不冷想約人來看\n地址台北市大安區",
    confidence: 0.82,
    fields: {
      subject: { value: "冷氣不冷", source: "ai", confidence: 0.8 },
      description: { value: "冷氣不冷想約人來看", source: "line", confidence: 0.95 },
    },
    missingFields: ["contactPhone", "address"],
    lineUserId: "Uline-alpha-customer-0001",
    customerLineIdentityId: "a1de0000-0000-4000-8000-000000000001",
    convertedServiceRequestId: null,
    lockVersion: 1,
    createdAt: "2026-07-18T01:59:00.000Z",
    updatedAt: "2026-07-18T02:00:00.000Z",
    messages: [
      {
        id: "c0000000-0000-4000-8000-000000000001",
        messageType: "text",
        text: "冷氣不冷想約人來看",
        sentAt: "2026-07-18T01:59:00.000Z",
        receivedAt: "2026-07-18T01:59:01.000Z",
        attachments: [],
      },
      {
        id: "c0000000-0000-4000-8000-000000000002",
        messageType: "image",
        text: null,
        sentAt: "2026-07-18T01:59:30.000Z",
        receivedAt: "2026-07-18T01:59:31.000Z",
        attachments: [
          {
            id: "d0000000-0000-4000-8000-000000000001",
            kind: "image",
            status: "ready",
            storagePath: "line/alpha/img-1.png",
          },
        ],
      },
    ],
    ...overrides,
  };
}

describe("PilotIntakeDraftReview", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    document.cookie = "renoly-csrf=0123456789abcdef0123456789abcdef; Path=/";
  });

  it("shows a loading state, then the immutable messages and AI fields", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(sessionResponse())
      .mockResolvedValueOnce(jsonResponse({ data: aiDraftDetail() }));
    vi.stubGlobal("fetch", fetchMock);

    render(<PilotIntakeDraftReview draftId={draftId} />);

    expect(screen.getByRole("status")).toBeInTheDocument();

    // Immutable original messages timeline (verbatim, not editable).
    const messagesHeading = await screen.findByRole("heading", { name: /原始訊息/ });
    const messagesCard = messagesHeading.closest("section") as HTMLElement;
    expect(within(messagesCard).getByText("冷氣不冷想約人來看")).toBeInTheDocument();
    expect(screen.getByText(/此區塊為 LINE 原始訊息，不可修改/)).toBeInTheDocument();
    // Image message rendered as an attachment marker (private path, not a public url).
    expect(within(messagesCard).getByText(/圖片附件/)).toBeInTheDocument();

    // AI fields carry per-field confidence + source.
    expect(screen.getByText("AI 擷取欄位")).toBeInTheDocument();
    const subjectField = screen.getByLabelText("主旨") as HTMLInputElement;
    expect(subjectField).toHaveValue("冷氣不冷");
    expect(subjectField.readOnly).toBe(false);
    expect(subjectField).toBeEnabled();

    // Missing fields are surfaced honestly.
    expect(screen.getByText(/contactPhone/)).toBeInTheDocument();
  });

  it("shows the degraded manual notice when the AI extraction failed", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(sessionResponse())
      .mockResolvedValueOnce(
        jsonResponse({
          data: aiDraftDetail({
            origin: "manual",
            summary: null,
            title: null,
            confidence: null,
            fields: {},
            missingFields: [],
          }),
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    render(<PilotIntakeDraftReview draftId={draftId} />);

    expect(await screen.findByText(/AI 整理失敗，可手動處理/)).toBeInTheDocument();
    // The original messages are still preserved and the form is still confirmable.
    const messagesHeading = screen.getByRole("heading", { name: /原始訊息/ });
    const messagesCard = messagesHeading.closest("section") as HTMLElement;
    expect(within(messagesCard).getByText("冷氣不冷想約人來看")).toBeInTheDocument();
    expect((screen.getByLabelText("主旨") as HTMLInputElement).readOnly).toBe(false);
    expect(screen.getByRole("button", { name: /建立服務案件/ })).toBeEnabled();
  });

  it("confirms the draft, creating a service_request, then shows the confirmed state", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(sessionResponse())
      .mockResolvedValueOnce(jsonResponse({ data: aiDraftDetail() }))
      .mockResolvedValueOnce(
        jsonResponse(
          {
            data: {
              serviceRequestId: "80000000-0000-4000-8000-000000000009",
              requestNo: "SR-202607-000001",
              draftId,
              draftStatus: "confirmed",
              status: "new",
              replayed: false,
            },
          },
          201,
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    render(<PilotIntakeDraftReview draftId={draftId} />);

    await screen.findByRole("heading", { name: /原始訊息/ });
    await userEvent.click(screen.getByRole("button", { name: /建立服務案件/ }));

    expect(await screen.findByText(/已建立服務案件/)).toBeInTheDocument();
    expect(screen.getByText("SR-202607-000001")).toBeInTheDocument();
    // A link to triage the newly created service request (M3).
    expect(screen.getByRole("link", { name: /前往整理進件/ })).toHaveAttribute(
      "href",
      "/app/inbox/80000000-0000-4000-8000-000000000009",
    );

    // The confirm call carried the lock + idempotency + overrides.
    const confirmCall = fetchMock.mock.calls[2];
    expect(confirmCall[0]).toContain(`/intake-drafts/${draftId}/actions/confirm`);
    const init = confirmCall[1] as RequestInit;
    expect((init.headers as Record<string, string>)["If-Match"]).toBe('"1"');
    expect((init.headers as Record<string, string>)["Idempotency-Key"]).toBeTruthy();
  });

  it("sends edited field values as overrides on confirm", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(sessionResponse())
      .mockResolvedValueOnce(jsonResponse({ data: aiDraftDetail() }))
      .mockResolvedValueOnce(
        jsonResponse(
          {
            data: {
              serviceRequestId: "80000000-0000-4000-8000-000000000009",
              requestNo: "SR-202607-000001",
              draftId,
              draftStatus: "confirmed",
              status: "new",
              replayed: false,
            },
          },
          201,
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    render(<PilotIntakeDraftReview draftId={draftId} />);

    const subject = await screen.findByLabelText("主旨");
    await userEvent.clear(subject);
    await userEvent.type(subject, "冷氣清洗保養");
    await userEvent.click(screen.getByRole("button", { name: /建立服務案件/ }));

    await screen.findByText(/已建立服務案件/);
    const init = fetchMock.mock.calls[2][1] as RequestInit;
    const body = JSON.parse(init.body as string);
    expect(body.fieldOverrides.subject.value).toBe("冷氣清洗保養");
    // An edited field is marked as a manual override.
    expect(body.fieldOverrides.subject.source).toBe("manual");
  });

  it("shows a restricted view to technicians without dispatch access", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(sessionResponse("technician")));

    render(<PilotIntakeDraftReview draftId={draftId} />);

    expect(await screen.findByText(/沒有.*權限/)).toBeInTheDocument();
  });

  it("shows an error state when the draft cannot be loaded and retries", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(sessionResponse())
      .mockResolvedValueOnce(jsonResponse({ title: "找不到" }, 404))
      .mockResolvedValueOnce(sessionResponse())
      .mockResolvedValueOnce(jsonResponse({ data: aiDraftDetail() }));
    vi.stubGlobal("fetch", fetchMock);

    render(<PilotIntakeDraftReview draftId={draftId} />);

    expect(await screen.findByRole("alert")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /重新載入/ }));
    await screen.findByRole("heading", { name: /原始訊息/ });
  });

  it("shows a confirmed state directly when the draft is already converted", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(sessionResponse())
      .mockResolvedValueOnce(
        jsonResponse({
          data: aiDraftDetail({
            status: "confirmed",
            convertedServiceRequestId: "80000000-0000-4000-8000-000000000009",
          }),
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    render(<PilotIntakeDraftReview draftId={draftId} />);

    expect(await screen.findByText(/已建立服務案件/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /建立服務案件/ })).not.toBeInTheDocument();
  });

  it("surfaces a confirm error without losing the draft", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(sessionResponse())
      .mockResolvedValueOnce(jsonResponse({ data: aiDraftDetail() }))
      .mockResolvedValueOnce(jsonResponse({ detail: "版本衝突，請重新載入。" }, 412));
    vi.stubGlobal("fetch", fetchMock);

    render(<PilotIntakeDraftReview draftId={draftId} />);

    await screen.findByRole("heading", { name: /原始訊息/ });
    await userEvent.click(screen.getByRole("button", { name: /建立服務案件/ }));

    expect(await screen.findByText("版本衝突，請重新載入。")).toBeInTheDocument();
    // The form is still there and the draft was not confirmed.
    expect(screen.getByRole("button", { name: /建立服務案件/ })).toBeInTheDocument();
    expect(screen.queryByText(/已建立服務案件/)).not.toBeInTheDocument();
  });

  it("surfaces a dismiss error", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(sessionResponse())
      .mockResolvedValueOnce(jsonResponse({ data: aiDraftDetail() }))
      .mockResolvedValueOnce(jsonResponse({ detail: "忽略失敗" }, 500));
    vi.stubGlobal("fetch", fetchMock);

    render(<PilotIntakeDraftReview draftId={draftId} />);

    await screen.findByRole("heading", { name: /原始訊息/ });
    await userEvent.click(screen.getByRole("button", { name: /忽略此進件/ }));

    expect(await screen.findByText("忽略失敗")).toBeInTheDocument();
    expect(screen.queryByText(/已忽略/)).not.toBeInTheDocument();
  });

  it("renders sticker and other message types with a null timestamp gracefully", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(sessionResponse())
      .mockResolvedValueOnce(
        jsonResponse({
          data: aiDraftDetail({
            confidence: null,
            messages: [
              {
                id: "c0000000-0000-4000-8000-00000000000a",
                messageType: "sticker",
                text: null,
                sentAt: null,
                receivedAt: "2026-07-18T01:59:01.000Z",
                attachments: [],
              },
              {
                id: "c0000000-0000-4000-8000-00000000000b",
                messageType: "other",
                text: "其他內容",
                sentAt: null,
                receivedAt: "2026-07-18T01:59:02.000Z",
                attachments: [],
              },
            ],
          }),
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    render(<PilotIntakeDraftReview draftId={draftId} />);

    const messagesHeading = await screen.findByRole("heading", { name: /原始訊息/ });
    const card = messagesHeading.closest("section") as HTMLElement;
    expect(within(card).getByText("貼圖")).toBeInTheDocument();
    expect(within(card).getByText("其他訊息")).toBeInTheDocument();
    // No overall-confidence chip in the header when overall confidence is null (the
    // page title heading anchors the header region; per-field chips are unaffected).
    const title = screen.getByRole("heading", { name: /LINE 進件（AI 摘要）/ });
    const header = title.closest("header") as HTMLElement;
    expect(within(header).queryByText(/信心 \d+%/)).not.toBeInTheDocument();
  });

  it("dismisses a draft as spam/unparseable", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(sessionResponse())
      .mockResolvedValueOnce(jsonResponse({ data: aiDraftDetail() }))
      .mockResolvedValueOnce(
        jsonResponse({ data: { draftId, draftStatus: "dismissed", replayed: false } }),
      );
    vi.stubGlobal("fetch", fetchMock);

    render(<PilotIntakeDraftReview draftId={draftId} />);

    await screen.findByRole("heading", { name: /原始訊息/ });
    await userEvent.click(screen.getByRole("button", { name: /忽略此進件/ }));

    expect(await screen.findByText(/已忽略/)).toBeInTheDocument();
    const dismissCall = fetchMock.mock.calls[2];
    expect(dismissCall[0]).toContain(`/intake-drafts/${draftId}/actions/dismiss`);
  });
});

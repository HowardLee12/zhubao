"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";

import { fetchPilotSession, PilotApiError } from "./api";
import {
  cancelServiceRequest,
  convertServiceRequest,
  createCustomer,
  declineServiceRequest,
  fetchCustomerAssets,
  fetchCustomerLocations,
  fetchOrganizationMembers,
  fetchServiceRequestDetail,
  fetchSimilarCustomers,
  patchServiceRequestSummary,
  triageServiceRequest,
  type ConvertMode,
  type CustomerAsset,
  type CustomerLocation,
  type OrganizationMember,
  type ServiceRequestActionResult,
  type ServiceRequestDetail,
  type ServiceRequestPriority,
  type SimilarCustomer,
} from "./triage-api";
import {
  Field,
  PilotBrand,
  PilotButton,
  PilotCard,
  PilotError,
  PilotInlineNotice,
  PilotInput,
  PilotLoading,
  PilotPage,
  PilotSelect,
  PilotTextarea,
} from "./ui";

const DISPATCH_ROLES = new Set(["owner", "admin", "dispatcher"]);

const CATEGORY_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: "cooling", label: "冷氣" },
  { value: "plumbing", label: "水電" },
  { value: "waterproofing", label: "抓漏防水" },
  { value: "appliance", label: "家電維修" },
  { value: "cleaning", label: "清潔" },
  { value: "painting", label: "油漆" },
  { value: "masonry", label: "泥作" },
  { value: "carpentry", label: "木工" },
  { value: "metalwork", label: "鐵工" },
  { value: "renovation", label: "局部裝修" },
  { value: "general_field_service", label: "一般到府服務" },
  { value: "out_of_scope", label: "不在服務範圍" },
  { value: "other", label: "其他" },
];

const PRIORITY_OPTIONS: ReadonlyArray<{ value: ServiceRequestPriority; label: string }> = [
  { value: "low", label: "低" },
  { value: "normal", label: "一般" },
  { value: "high", label: "高" },
  { value: "urgent", label: "緊急" },
];

const statusLabels: Record<ServiceRequestDetail["status"], string> = {
  new: "待處理",
  triaged: "已分流",
  quoting: "報價中",
  quoted: "已報價",
  converted: "已轉換",
  declined: "不適用",
  cancelled: "已取消",
};

type LoadStatus = "loading" | "ready" | "error" | "restricted";

type Toast = { tone: "info" | "success" | "error"; message: string } | null;

interface SummaryForm {
  subject: string;
  description: string;
  contactName: string;
  contactPhone: string;
  category: string;
  priority: ServiceRequestPriority;
  internalNote: string;
}

interface CustomerBinding {
  customerId: string | null;
  customerLabel: string | null;
  locationId: string | null;
  assetId: string | null;
}

type CloseKind = "decline" | "cancel";

function summaryFormFromDetail(detail: ServiceRequestDetail): SummaryForm {
  return {
    subject: detail.subject,
    description: detail.description,
    contactName: detail.contactName,
    contactPhone: detail.contactPhone ?? "",
    category: detail.category ?? "",
    priority: detail.priority,
    internalNote: detail.internalNote ?? "",
  };
}

function bindingFromDetail(detail: ServiceRequestDetail): CustomerBinding {
  return {
    customerId: detail.customerId,
    customerLabel: detail.customerId ? detail.contactName : null,
    locationId: detail.locationId,
    assetId: detail.assetId,
  };
}

function formatDateTime(value: string | null): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat("zh-TW", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Taipei",
  }).format(new Date(value));
}

export function PilotRequestDetail({
  organizationId,
  requestId,
}: Readonly<{ organizationId: string; requestId: string }>) {
  const [loadStatus, setLoadStatus] = useState<LoadStatus>("loading");
  const [detail, setDetail] = useState<ServiceRequestDetail | null>(null);
  const [members, setMembers] = useState<OrganizationMember[]>([]);
  const [summary, setSummary] = useState<SummaryForm | null>(null);
  const [binding, setBinding] = useState<CustomerBinding>({
    customerId: null,
    customerLabel: null,
    locationId: null,
    assetId: null,
  });
  const [assignedMemberId, setAssignedMemberId] = useState<string>("");
  // Controlled inputs can emit several changes immediately before the action
  // click (especially on fast desktop automation / WebViews). Refs mirror the
  // latest event values synchronously so a submit never sends the previous
  // render's category, priority, note, binding or assignee.
  const summaryRef = useRef<SummaryForm | null>(null);
  const bindingRef = useRef<CustomerBinding>({
    customerId: null,
    customerLabel: null,
    locationId: null,
    assetId: null,
  });
  const assignedMemberIdRef = useRef("");
  const loadSequenceRef = useRef(0);
  const [similar, setSimilar] = useState<SimilarCustomer[]>([]);
  const [locations, setLocations] = useState<CustomerLocation[]>([]);
  const [assets, setAssets] = useState<CustomerAsset[]>([]);
  const [savingSummary, setSavingSummary] = useState(false);
  const [creatingCustomer, setCreatingCustomer] = useState(false);
  const creatingCustomerRef = useRef(false);
  const [busyAction, setBusyAction] = useState(false);
  const [toast, setToast] = useState<Toast>(null);
  const [convertOpen, setConvertOpen] = useState(false);
  const [convertMode, setConvertMode] = useState<ConvertMode>("singleVisit");
  const [closeKind, setCloseKind] = useState<CloseKind | null>(null);
  const [closeReason, setCloseReason] = useState("");
  const [needMoreInfo, setNeedMoreInfo] = useState(false);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "error">("idle");
  const [convertedCaseNo, setConvertedCaseNo] = useState<string | null>(null);

  const applyDetail = useCallback((next: ServiceRequestDetail) => {
    setDetail(next);
    const nextSummary = summaryFormFromDetail(next);
    const nextBinding = bindingFromDetail(next);
    const nextAssignee = next.assignedMemberId ?? "";
    summaryRef.current = nextSummary;
    bindingRef.current = nextBinding;
    assignedMemberIdRef.current = nextAssignee;
    setSummary(nextSummary);
    setBinding(nextBinding);
    setAssignedMemberId(nextAssignee);
    setConvertedCaseNo(next.convertedWorkOrderNo ?? next.convertedProjectNo ?? null);
  }, []);

  // The triage / decline / cancel routes return the compact ActionResult, not the
  // full detail DTO. Merge its fields onto the loaded detail so content columns it
  // omits (subject, description, requestNo, originalSubmission, …) are preserved.
  const applyActionResult = useCallback((result: ServiceRequestActionResult) => {
    setDetail((current) => {
      if (!current) return current;
      return {
        ...current,
        status: result.status,
        priority: result.priority,
        category: result.category,
        customerId: result.customerId,
        locationId: result.locationId,
        assetId: result.assetId,
        assignedMemberId: result.assignedMemberId,
        triagedAt: result.triagedAt,
        convertedAt: result.convertedAt,
        convertedProjectId: result.convertedProjectId,
        convertedWorkOrderId: result.convertedWorkOrderId,
        lockVersion: result.lockVersion,
        updatedAt: result.updatedAt,
      };
    });
    const nextAssignee = result.assignedMemberId ?? "";
    assignedMemberIdRef.current = nextAssignee;
    setAssignedMemberId(nextAssignee);
  }, []);

  const reloadDetail = useCallback(async () => {
    const fresh = await fetchServiceRequestDetail(organizationId, requestId);
    applyDetail(fresh);
    return fresh;
  }, [applyDetail, organizationId, requestId]);

  const load = useCallback(async () => {
    const loadSequence = loadSequenceRef.current + 1;
    loadSequenceRef.current = loadSequence;
    setLoadStatus("loading");
    try {
      const session = await fetchPilotSession();
      const activeMembership = session.memberships.find(
        (membership) => membership.status === "active",
      );
      if (!activeMembership || !DISPATCH_ROLES.has(activeMembership.role)) {
        if (loadSequence !== loadSequenceRef.current) return;
        setLoadStatus("restricted");
        return;
      }
      const [fresh, memberList] = await Promise.all([
        fetchServiceRequestDetail(organizationId, requestId),
        fetchOrganizationMembers(organizationId).catch(() => [] as OrganizationMember[]),
      ]);
      if (loadSequence !== loadSequenceRef.current) return;
      applyDetail(fresh);
      setMembers(memberList.filter((member) => member.status === "active"));
      setLoadStatus("ready");

      if (fresh.customerId) {
        void loadCustomerContext(fresh.customerId);
      }
      void loadSimilar(fresh);
    } catch (error) {
      if (loadSequence !== loadSequenceRef.current) return;
      if (error instanceof PilotApiError && error.status === 403) {
        setLoadStatus("restricted");
        return;
      }
      setLoadStatus("error");
    }
    // loadCustomerContext / loadSimilar are stable via useCallback below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [applyDetail, organizationId, requestId]);

  const loadSimilar = useCallback(
    async (source: ServiceRequestDetail) => {
      try {
        const rows = await fetchSimilarCustomers(organizationId, {
          phone: source.contactPhone,
          name: source.contactName,
        });
        setSimilar(rows);
      } catch {
        setSimilar([]);
      }
    },
    [organizationId],
  );

  const loadCustomerContext = useCallback(
    async (customerId: string) => {
      const [locationRows, assetRows] = await Promise.all([
        fetchCustomerLocations(organizationId, customerId).catch(() => [] as CustomerLocation[]),
        fetchCustomerAssets(organizationId, customerId).catch(() => [] as CustomerAsset[]),
      ]);
      setLocations(locationRows);
      setAssets(assetRows);
    },
    [organizationId],
  );

  useEffect(() => {
    void load();
  }, [load]);

  const updateSummary = useCallback(
    <Key extends keyof SummaryForm>(key: Key, value: SummaryForm[Key]) => {
      const current = summaryRef.current;
      if (!current) return;
      const next = { ...current, [key]: value };
      summaryRef.current = next;
      setSummary(next);
    },
    [],
  );

  const updateBinding = useCallback((next: CustomerBinding) => {
    bindingRef.current = next;
    setBinding(next);
  }, []);

  const linkExistingCustomer = useCallback(
    async (customer: SimilarCustomer) => {
      const nextBinding = {
        customerId: customer.customerId,
        customerLabel: customer.name,
        locationId: null,
        assetId: null,
      };
      updateBinding(nextBinding);
      await loadCustomerContext(customer.customerId);
    },
    [loadCustomerContext, updateBinding],
  );

  const createAndLinkCustomer = useCallback(async () => {
    if (!detail || creatingCustomerRef.current) return;
    creatingCustomerRef.current = true;
    setCreatingCustomer(true);
    setToast(null);
    try {
      const customer = await createCustomer(organizationId, {
        name: detail.contactName,
        phone: detail.contactPhone,
      });
      const nextBinding = {
        customerId: customer.id,
        customerLabel: `${customer.name}｜${customer.customerNo}`,
        locationId: null,
        assetId: null,
      };
      updateBinding(nextBinding);
      await loadCustomerContext(customer.id);
      setToast({ tone: "success", message: `已建立並連結客戶 ${customer.customerNo}。` });
    } catch (error) {
      const message = error instanceof Error ? error.message : "客戶建立失敗，請稍後再試。";
      setToast({ tone: "error", message });
    } finally {
      creatingCustomerRef.current = false;
      setCreatingCustomer(false);
    }
  }, [detail, loadCustomerContext, organizationId, updateBinding]);

  const handleConflict = useCallback(
    async (error: unknown, fallback: string) => {
      if (error instanceof PilotApiError && error.status === 412) {
        setToast({ tone: "error", message: "已被他人更新，已重新載入了最新內容，請再確認一次。" });
        await reloadDetail().catch(() => undefined);
        return;
      }
      const message = error instanceof Error ? error.message : fallback;
      setToast({ tone: "error", message });
    },
    [reloadDetail],
  );

  const saveSummary = useCallback(async () => {
    const latestSummary = summaryRef.current;
    if (!detail || !latestSummary) return;
    setSavingSummary(true);
    setToast(null);
    try {
      const updated = await patchServiceRequestSummary(organizationId, requestId, detail.lockVersion, {
        subject: latestSummary.subject.trim(),
        description: latestSummary.description.trim(),
        contactName: latestSummary.contactName.trim(),
        contactPhone: latestSummary.contactPhone.trim() || null,
        category: latestSummary.category || null,
        priority: latestSummary.priority,
      });
      applyDetail(updated);
      setToast({ tone: "success", message: "摘要已更新。" });
    } catch (error) {
      await handleConflict(error, "摘要儲存失敗，請稍後再試。");
    } finally {
      setSavingSummary(false);
    }
  }, [applyDetail, detail, handleConflict, organizationId, requestId]);

  const runTriage = useCallback(async () => {
    const latestSummary = summaryRef.current;
    const latestBinding = bindingRef.current;
    const latestAssignee = assignedMemberIdRef.current;
    if (!detail || !latestSummary) return;
    if (!latestBinding.customerId) {
      setToast({ tone: "error", message: "請先連結或建立客戶再分流。" });
      return;
    }
    setBusyAction(true);
    setToast(null);
    try {
      const updated = await triageServiceRequest(organizationId, requestId, detail.lockVersion, {
        customerId: latestBinding.customerId,
        locationId: latestBinding.locationId,
        assetId: latestBinding.assetId,
        assignedMemberId: latestAssignee || null,
        priority: latestSummary.priority,
        category: latestSummary.category || null,
        internalNote: latestSummary.internalNote.trim() || null,
      });
      applyActionResult(updated);
      setNeedMoreInfo(false);
      setToast({ tone: "success", message: "案件已分流。" });
    } catch (error) {
      await handleConflict(error, "分流失敗，請稍後再試。");
    } finally {
      setBusyAction(false);
    }
  }, [
    applyActionResult,
    detail,
    handleConflict,
    organizationId,
    requestId,
  ]);

  const runConvert = useCallback(async () => {
    if (!detail) return;
    setBusyAction(true);
    setToast(null);
    try {
      const idempotencyKey = globalThis.crypto.randomUUID();
      const result = await convertServiceRequest(
        organizationId,
        requestId,
        detail.lockVersion,
        idempotencyKey,
        {
          mode: convertMode,
          projectTitle: convertMode === "project" ? summary?.subject.trim() : undefined,
          workOrder: { title: summary?.subject.trim() || detail.subject },
        },
      );
      setConvertOpen(false);
      // Reflect the converted state from the conversion result. The RPC replays
      // existing conversions, so this envelope is authoritative for both a fresh
      // convert and an idempotent replay — no follow-up reload needed.
      setDetail((current) =>
        current
          ? {
              ...current,
              status: result.serviceRequest.status,
              lockVersion: result.serviceRequest.lockVersion,
              convertedAt: result.serviceRequest.convertedAt,
              convertedWorkOrderId: result.workOrder?.id ?? current.convertedWorkOrderId,
              convertedProjectId: result.project?.id ?? current.convertedProjectId,
              convertedWorkOrderNo:
                result.workOrder?.workOrderNo ?? current.convertedWorkOrderNo,
              convertedProjectNo: result.project?.projectNo ?? current.convertedProjectNo,
            }
          : current,
      );
      const targetNo = result.workOrder?.workOrderNo ?? result.project?.projectNo ?? "";
      setConvertedCaseNo(targetNo || null);
      setToast({
        tone: "success",
        message: targetNo ? `已轉換為案件 ${targetNo}。` : "已轉換為案件。",
      });
    } catch (error) {
      await handleConflict(error, "轉換失敗，請稍後再試。");
    } finally {
      setBusyAction(false);
    }
  }, [convertMode, detail, handleConflict, organizationId, requestId, summary]);

  const runClose = useCallback(async () => {
    if (!detail || !closeKind) return;
    const reason = closeReason.trim();
    if (reason.length < 2) {
      setToast({ tone: "error", message: "請填寫至少兩個字的原因。" });
      return;
    }
    setBusyAction(true);
    setToast(null);
    try {
      const action = closeKind === "decline" ? declineServiceRequest : cancelServiceRequest;
      const updated = await action(organizationId, requestId, detail.lockVersion, reason);
      applyActionResult(updated);
      setCloseKind(null);
      setCloseReason("");
      setToast({
        tone: "success",
        message: closeKind === "decline" ? "案件已標為不適用。" : "案件已取消。",
      });
    } catch (error) {
      await handleConflict(error, "操作失敗，請稍後再試。");
    } finally {
      setBusyAction(false);
    }
  }, [applyActionResult, closeKind, closeReason, detail, handleConflict, organizationId, requestId]);

  const copyFollowUpLink = useCallback(async () => {
    if (!detail) return;
    const phone = detail.contactPhone ?? "";
    const text = `${detail.contactName} 您好，關於報修單 ${detail.requestNo}，我們需要您補充一些資訊，方便回覆嗎？`;
    try {
      await navigator.clipboard.writeText(phone ? `${text}（聯絡電話：${phone}）` : text);
      setCopyState("copied");
    } catch {
      setCopyState("error");
    }
  }, [detail]);

  if (loadStatus === "loading") {
    return (
      <PilotPage>
        <PilotBrand eyebrow="接案整理" />
        <PilotLoading label="正在載入案件內容" />
      </PilotPage>
    );
  }

  if (loadStatus === "restricted") {
    return (
      <PilotPage>
        <PilotBrand eyebrow="接案整理" />
        <PilotCard className="py-10 text-center">
          <h1 className="text-xl font-black tracking-tight text-ink">沒有整理案件的權限</h1>
          <p className="mt-2 text-sm leading-6 text-ink-3">
            只有具派工權限的成員才能整理與分流進件。請聯絡店家管理員調整你的角色。
          </p>
        </PilotCard>
      </PilotPage>
    );
  }

  if (loadStatus === "error" || !detail || !summary) {
    return (
      <PilotPage>
        <PilotBrand eyebrow="接案整理" />
        <PilotError
          title="案件內容暫時讀不到"
          description="需求仍保存在系統中。請確認網路後重新載入。"
          actionLabel="重新載入"
          onRetry={() => void load()}
        />
      </PilotPage>
    );
  }

  const isClosed = detail.status === "declined" || detail.status === "cancelled";
  const isConverted = detail.status === "converted";
  const canTriage = detail.status === "new" || detail.status === "triaged";
  const canConvert = detail.status === "triaged" || detail.status === "quoting" || detail.status === "quoted";

  return (
    <PilotPage>
      <PilotBrand eyebrow="接案整理" />
      <Link
        href="/app/inbox"
        className="mb-4 inline-flex min-h-10 items-center text-sm font-bold text-orange-deep"
      >
        ← 回接案匣
      </Link>

      <header className="mb-4 flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-bold text-orange-deep">{detail.requestNo}</p>
          <h1 className="mt-1 text-2xl font-black tracking-[-0.03em] text-ink">{detail.subject}</h1>
        </div>
        <span className="shrink-0 rounded-full bg-ink px-3 py-1 text-xs font-bold text-white">
          {statusLabels[detail.status]}
        </span>
      </header>

      {toast ? (
        <div className="mb-4">
          <PilotInlineNotice tone={toast.tone}>{toast.message}</PilotInlineNotice>
        </div>
      ) : null}

      {needMoreInfo ? (
        <div className="mb-4">
          <PilotCard className="border-orange/30 bg-orange-soft/40">
            <p className="text-sm font-black text-orange-deep">待補資料</p>
            <p className="mt-1 text-sm leading-6 text-ink-2">
              這筆進件已標記為需要向客戶補資料。現階段不會自動從 LINE 送出，請先複製下方訊息，手動傳給客戶。
            </p>
            <PilotButton variant="secondary" className="mt-3 w-full" onClick={() => void copyFollowUpLink()}>
              複製聯絡訊息
            </PilotButton>
            {copyState === "copied" ? (
              <p role="status" className="mt-2 text-center text-xs font-bold text-[var(--warm-green)]">
                訊息已複製，可直接貼到 LINE。
              </p>
            ) : null}
            {copyState === "error" ? (
              <p role="alert" className="mt-2 text-center text-xs font-bold text-[var(--warm-red)]">
                無法自動複製，請長按內容手動複製。
              </p>
            ) : null}
          </PilotCard>
        </div>
      ) : null}

      {isConverted ? (
        <div className="mb-4">
          <PilotCard className="border-[var(--warm-green)]/30 bg-[var(--warm-green-soft)]/40">
            <p className="text-sm font-black text-[var(--warm-green)]">已轉換為案件</p>
            <p className="mt-1 text-sm leading-6 text-ink-2">
              這筆進件已建立案件，無法再次轉換。
            </p>
            {convertedCaseNo ? (
              <p className="mt-1 font-mono text-sm font-bold text-ink-2">{convertedCaseNo}</p>
            ) : null}
            <p className="mt-3 rounded-xl border border-warm-border bg-white/70 px-3 py-2 text-xs leading-5 text-ink-3">
              案件工作台會在下一個里程碑開放；目前轉換結果已確實寫入資料庫。
            </p>
          </PilotCard>
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <PilotCard>
          <h2 className="text-base font-black text-ink">原始需求（客戶送出的內容）</h2>
          <p className="mt-1 text-xs text-ink-3">此區塊為送出當下的存證，不可修改。</p>
          <dl className="mt-4 space-y-3 text-sm">
            <div>
              <dt className="text-xs font-bold text-ink-3">聯絡人</dt>
              <dd className="mt-0.5 font-bold text-ink-2">
                {detail.originalSubmission?.contactName ?? detail.contactName}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-bold text-ink-3">電話</dt>
              <dd className="mt-0.5 text-ink-2">
                {detail.originalSubmission?.contactPhone ?? detail.contactPhone ?? "—"}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-bold text-ink-3">主旨</dt>
              <dd className="mt-0.5 text-ink-2">
                {detail.originalSubmission?.subject ?? detail.subject}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-bold text-ink-3">內容</dt>
              <dd className="mt-0.5 whitespace-pre-wrap leading-6 text-ink-2">
                {detail.originalSubmission?.description ?? detail.description}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-bold text-ink-3">送出時間</dt>
              <dd className="mt-0.5 text-ink-2">
                {formatDateTime(detail.originalSubmission?.submittedAt ?? detail.createdAt)}
              </dd>
            </div>
          </dl>
        </PilotCard>

        <PilotCard>
          <h2 className="text-base font-black text-ink">整理後摘要</h2>
          {detail.summaryEditedBy ? (
            <p className="mt-1 text-xs text-ink-3">
              最後編輯：團隊成員（{formatDateTime(detail.summaryEditedAt)}）
            </p>
          ) : (
            <p className="mt-1 text-xs text-ink-3">尚未有人編輯摘要。</p>
          )}
          <div className="mt-4 space-y-4">
            <Field>
              <label htmlFor="summary-subject" className="mb-1.5 block text-sm font-bold text-ink-2">
                主旨
              </label>
              <PilotInput
                id="summary-subject"
                value={summary.subject}
                maxLength={160}
                onChange={(event) => updateSummary("subject", event.target.value)}
              />
            </Field>
            <Field>
              <label htmlFor="summary-description" className="mb-1.5 block text-sm font-bold text-ink-2">
                內容
              </label>
              <PilotTextarea
                id="summary-description"
                value={summary.description}
                maxLength={10000}
                onChange={(event) => updateSummary("description", event.target.value)}
              />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field>
                <label htmlFor="summary-contact" className="mb-1.5 block text-sm font-bold text-ink-2">
                  聯絡人
                </label>
                <PilotInput
                  id="summary-contact"
                  value={summary.contactName}
                  maxLength={120}
                  onChange={(event) => updateSummary("contactName", event.target.value)}
                />
              </Field>
              <Field>
                <label htmlFor="summary-phone" className="mb-1.5 block text-sm font-bold text-ink-2">
                  電話
                </label>
                <PilotInput
                  id="summary-phone"
                  value={summary.contactPhone}
                  onChange={(event) => updateSummary("contactPhone", event.target.value)}
                />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field>
                <label htmlFor="summary-category" className="mb-1.5 block text-sm font-bold text-ink-2">
                  服務類別
                </label>
                <PilotSelect
                  id="summary-category"
                  value={summary.category}
                  onChange={(event) => updateSummary("category", event.target.value)}
                >
                  <option value="">未分類</option>
                  {CATEGORY_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </PilotSelect>
              </Field>
              <Field>
                <label htmlFor="summary-priority" className="mb-1.5 block text-sm font-bold text-ink-2">
                  優先度
                </label>
                <PilotSelect
                  id="summary-priority"
                  value={summary.priority}
                  onChange={(event) =>
                    updateSummary("priority", event.target.value as ServiceRequestPriority)
                  }
                >
                  {PRIORITY_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </PilotSelect>
              </Field>
            </div>
            <Field hint="內部備註不會顯示給客戶。">
              <label htmlFor="summary-note" className="mb-1.5 block text-sm font-bold text-ink-2">
                內部備註
              </label>
              <PilotTextarea
                id="summary-note"
                value={summary.internalNote}
                maxLength={2000}
                onChange={(event) => updateSummary("internalNote", event.target.value)}
              />
            </Field>
            <PilotButton
              className="w-full"
              disabled={savingSummary || isClosed}
              onClick={() => void saveSummary()}
            >
              {savingSummary ? "儲存中…" : "儲存摘要"}
            </PilotButton>
          </div>
        </PilotCard>
      </div>

      <PilotCard className="mt-4">
        <h2 className="text-base font-black text-ink">客戶</h2>
        <p className="mt-1 text-xs leading-5 text-ink-3">
          系統只提供比較，<strong>不會自動合併</strong>。請由你決定要連結既有客戶，或建立一筆新客戶資料。
        </p>

        {binding.customerId ? (
          <div className="mt-3 rounded-2xl border border-[var(--warm-green)]/30 bg-[var(--warm-green-soft)]/40 p-3.5">
            <p className="text-sm font-bold text-ink-2">
              已連結客戶：{binding.customerLabel ?? binding.customerId}
            </p>
            <button
              type="button"
              className="mt-1 text-xs font-bold text-orange-deep underline"
              onClick={() =>
                updateBinding({
                  customerId: null,
                  customerLabel: null,
                  locationId: null,
                  assetId: null,
                })
              }
            >
              改為其他客戶
            </button>
          </div>
        ) : (
          <div className="mt-3 space-y-3">
            {similar.length > 0 ? (
              <ul className="space-y-2">
                {similar.map((candidate) => (
                  <li
                    key={candidate.customerId}
                    className="flex items-center justify-between gap-3 rounded-2xl border border-warm-border bg-white p-3.5"
                  >
                    <div>
                      <p className="text-sm font-bold text-ink-2">{candidate.name}</p>
                      <p className="text-xs text-ink-3">
                        {candidate.customerNo} · {candidate.phone ?? "無電話"} ·{" "}
                        {candidate.matchReason === "phone" ? "電話相似" : "姓名相似"}
                      </p>
                    </div>
                    <PilotButton
                      variant="secondary"
                      onClick={() => void linkExistingCustomer(candidate)}
                    >
                      連結既有客戶
                    </PilotButton>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-ink-3">沒有找到相似客戶。</p>
            )}
            <button
              type="button"
              disabled={creatingCustomer}
              className="w-full rounded-xl border border-dashed border-warm-border-strong px-4 py-3 text-sm font-bold text-ink-2"
              onClick={() => void createAndLinkCustomer()}
            >
              {creatingCustomer ? "建立中…" : "建立新客戶"}
            </button>
          </div>
        )}

        {binding.customerId ? (
          <div className="mt-4 space-y-3">
            <Field hint="設備為選配，可先略過。">
              <label htmlFor="binding-location" className="mb-1.5 block text-sm font-bold text-ink-2">
                服務地址
              </label>
              <PilotSelect
                id="binding-location"
                value={binding.locationId ?? ""}
                onChange={(event) =>
                  updateBinding({
                    ...bindingRef.current,
                    locationId: event.target.value || null,
                    assetId: null,
                  })
                }
              >
                <option value="">略過 / 稍後確認</option>
                {locations.map((location) => (
                  <option key={location.id} value={location.id}>
                    {location.label}｜{location.addressLine}
                  </option>
                ))}
              </PilotSelect>
            </Field>
            {binding.locationId ? (
              <Field>
                <label htmlFor="binding-asset" className="mb-1.5 block text-sm font-bold text-ink-2">
                  設備（選配）
                </label>
                <PilotSelect
                  id="binding-asset"
                  value={binding.assetId ?? ""}
                  onChange={(event) =>
                    updateBinding({
                      ...bindingRef.current,
                      assetId: event.target.value || null,
                    })
                  }
                >
                  <option value="">略過</option>
                  {assets
                    .filter((asset) => asset.locationId === binding.locationId)
                    .map((asset) => (
                      <option key={asset.id} value={asset.id}>
                        {asset.name}
                        {asset.brand ? `｜${asset.brand}` : ""}
                      </option>
                    ))}
                </PilotSelect>
              </Field>
            ) : null}
          </div>
        ) : null}
      </PilotCard>

      <PilotCard className="mt-4">
        <h2 className="text-base font-black text-ink">負責人</h2>
        <Field hint="指派後會記錄責任人與時間。">
          <label htmlFor="assignee" className="mb-1.5 mt-2 block text-sm font-bold text-ink-2">
            指派師傅
          </label>
          <PilotSelect
            id="assignee"
            value={assignedMemberId}
            onChange={(event) => {
              assignedMemberIdRef.current = event.target.value;
              setAssignedMemberId(event.target.value);
            }}
          >
            <option value="">未指派</option>
            {members.map((member) => (
              <option key={member.id} value={member.id}>
                {member.displayName}
              </option>
            ))}
          </PilotSelect>
        </Field>
      </PilotCard>

      {!isClosed ? (
        <div className="mt-5 space-y-3">
          {canTriage ? (
            <PilotButton className="w-full" disabled={busyAction} onClick={() => void runTriage()}>
              {busyAction ? "處理中…" : "分流案件"}
            </PilotButton>
          ) : null}
          {canConvert ? (
            <PilotButton
              variant="secondary"
              className="w-full"
              disabled={busyAction}
              onClick={() => setConvertOpen(true)}
            >
              轉換為案件
            </PilotButton>
          ) : null}
          <div className="grid grid-cols-2 gap-3">
            <PilotButton
              variant="secondary"
              disabled={busyAction || needMoreInfo}
              onClick={() => setNeedMoreInfo(true)}
            >
              要求補資料
            </PilotButton>
            <PilotButton variant="danger" disabled={busyAction} onClick={() => setCloseKind("decline")}>
              標為不適用
            </PilotButton>
          </div>
          <PilotButton
            variant="secondary"
            className="w-full"
            disabled={busyAction}
            onClick={() => setCloseKind("cancel")}
          >
            取消案件
          </PilotButton>
        </div>
      ) : null}

      {convertOpen ? (
        <div className="fixed inset-0 z-50 flex items-end bg-black/45 p-4 sm:items-center sm:justify-center">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="convert-title"
            className="w-full max-w-sm rounded-[24px] bg-white p-5 shadow-2xl"
          >
            <h2 id="convert-title" className="text-xl font-black text-ink">
              轉換為案件
            </h2>
            <p className="mt-2 text-sm leading-6 text-ink-3">
              轉換後會依模板建立工單與檢查表，且此進件無法再次轉換。
            </p>
            <Field>
              <label htmlFor="convert-mode" className="mb-1.5 mt-4 block text-sm font-bold text-ink-2">
                轉換方式
              </label>
              <PilotSelect
                id="convert-mode"
                value={convertMode}
                onChange={(event) => setConvertMode(event.target.value as ConvertMode)}
              >
                <option value="singleVisit">單次到府（建立工單）</option>
                <option value="project">專案（建立案件 + 工單）</option>
              </PilotSelect>
            </Field>
            <div className="mt-5 grid grid-cols-2 gap-3">
              <PilotButton variant="secondary" disabled={busyAction} onClick={() => setConvertOpen(false)}>
                取消
              </PilotButton>
              <PilotButton disabled={busyAction} onClick={() => void runConvert()}>
                {busyAction ? "轉換中…" : "確認轉換"}
              </PilotButton>
            </div>
          </div>
        </div>
      ) : null}

      {closeKind ? (
        <div className="fixed inset-0 z-50 flex items-end bg-black/45 p-4 sm:items-center sm:justify-center">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="close-title"
            className="w-full max-w-sm rounded-[24px] bg-white p-5 shadow-2xl"
          >
            <h2 id="close-title" className="text-xl font-black text-ink">
              {closeKind === "decline" ? "標為不適用" : "取消案件"}
            </h2>
            <Field hint="原因會記錄在稽核紀錄中。">
              <label htmlFor="close-reason" className="mb-1.5 mt-3 block text-sm font-bold text-ink-2">
                原因
              </label>
              <PilotTextarea
                id="close-reason"
                value={closeReason}
                maxLength={1000}
                onChange={(event) => setCloseReason(event.target.value)}
              />
            </Field>
            <div className="mt-5 grid grid-cols-2 gap-3">
              <PilotButton
                variant="secondary"
                disabled={busyAction}
                onClick={() => {
                  setCloseKind(null);
                  setCloseReason("");
                }}
              >
                返回
              </PilotButton>
              <PilotButton variant="danger" disabled={busyAction} onClick={() => void runClose()}>
                {closeKind === "decline" ? "確認標為不適用" : "確認取消"}
              </PilotButton>
            </div>
          </div>
        </div>
      ) : null}
    </PilotPage>
  );
}

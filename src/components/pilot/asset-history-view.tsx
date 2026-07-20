"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { fetchPilotSession, type PilotMembership } from "./api";
import { fetchAssetHistory, type AssetHistory } from "./operations-api";
import {
  assetEventLabel,
  assetTypeLabel,
  formatLocalDate,
} from "./operations-format";
import {
  PilotBrand,
  PilotCard,
  PilotError,
  PilotLoading,
  PilotPage,
} from "./ui";
import { formatDateTime, WORK_ORDER_STATUS_LABELS } from "./work-order-format";

type LoadState = "loading" | "ready" | "error";

// Asset history is a projection of the append-only asset event log merged with
// related work orders. It NEVER carries cost/amount — it is safe on the technician
// surface. Assets are optional (leak/waterproofing jobs may have none), so the
// empty state says so plainly rather than nagging.
export function AssetHistoryView({ assetId }: { assetId: string }) {
  const [attempt, setAttempt] = useState(0);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [history, setHistory] = useState<AssetHistory | null>(null);

  const reload = useCallback(
    async (orgId: string) => {
      const data = await fetchAssetHistory(orgId, assetId);
      setHistory(data);
    },
    [assetId],
  );

  useEffect(() => {
    let active = true;
    void fetchPilotSession()
      .then(async (sessionData) => {
        const membership: PilotMembership | undefined = sessionData.memberships.find(
          (m) => m.status === "active",
        );
        if (!membership) throw new Error("尚未建立工作空間");
        await reload(membership.organizationId);
        if (!active) return;
        setLoadState("ready");
      })
      .catch(() => {
        if (active) setLoadState("error");
      });
    return () => {
      active = false;
    };
  }, [attempt, reload]);

  if (loadState === "loading") {
    return (
      <PilotPage>
        <PilotBrand eyebrow="設備履歷" />
        <PilotLoading label="正在載入設備履歷" />
      </PilotPage>
    );
  }

  if (loadState === "error" || !history) {
    return (
      <PilotPage>
        <PilotBrand eyebrow="設備履歷" />
        <PilotError
          title="設備履歷讀不到"
          description="連線可能暫時中斷，設備資料不會因此改變。請重新載入。"
          actionLabel="重新載入"
          onRetry={() => {
            setLoadState("loading");
            setAttempt((c) => c + 1);
          }}
        />
      </PilotPage>
    );
  }

  const { asset, events, workOrders } = history;
  const hasHistory = events.length > 0 || workOrders.length > 0;

  return (
    <PilotPage>
      <PilotBrand eyebrow="設備履歷" />
      <Link
        href="/app/follow-ups"
        className="mb-4 inline-flex min-h-10 items-center text-sm font-bold text-orange-deep"
      >
        ← 回回訪清單
      </Link>

      <PilotCard>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-xl font-black text-ink">{asset.name}</h1>
            <p className="mt-0.5 text-xs text-ink-3">
              {assetTypeLabel(asset.assetType)} · {asset.assetNo}
            </p>
          </div>
          {asset.status === "retired" ? (
            <span className="shrink-0 rounded-full bg-warm-border px-3 py-1 text-xs font-bold text-ink-3">
              已停用
            </span>
          ) : null}
        </div>
        <dl className="mt-4 space-y-1.5 text-xs text-ink-3">
          <Row label="品牌" value={asset.brand} />
          <Row label="型號" value={asset.model} />
          <Row label="序號" value={asset.serialNumber} />
          <Row label="安裝日期" value={asset.installedOn ? formatLocalDate(asset.installedOn) : null} />
          <Row
            label="保固到期"
            value={asset.warrantyExpiresOn ? formatLocalDate(asset.warrantyExpiresOn) : null}
          />
          <Row
            label="最近服務"
            value={asset.lastServicedAt ? formatDateTime(asset.lastServicedAt) : null}
          />
        </dl>
      </PilotCard>

      <h2 className="mb-3 mt-6 text-sm font-black text-ink-2">服務履歷</h2>
      {hasHistory ? (
        <ul className="space-y-3">
          {events.map((event) => (
            <li key={`${event.chainSequence}-${event.occurredAt}`}>
              <PilotCard className="p-4">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-black text-ink">{assetEventLabel(event.eventType)}</p>
                  <p className="text-xs text-ink-3">{formatDateTime(event.occurredAt)}</p>
                </div>
                {typeof event.payload?.summary === "string" ? (
                  <p className="mt-1.5 text-sm leading-6 text-ink-2">
                    {event.payload.summary as string}
                  </p>
                ) : null}
              </PilotCard>
            </li>
          ))}
          {workOrders.map((wo) => (
            <li key={wo.workOrderId}>
              <PilotCard className="p-4">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-black text-ink">{wo.workOrderNo}</p>
                  <span className="rounded-full bg-warm-border px-2.5 py-0.5 text-xs font-bold text-ink-3">
                    {WORK_ORDER_STATUS_LABELS[wo.status as keyof typeof WORK_ORDER_STATUS_LABELS] ??
                      wo.status}
                  </span>
                </div>
                <p className="mt-1.5 text-xs text-ink-3">
                  {wo.completedAt
                    ? `完工 ${formatDateTime(wo.completedAt)}`
                    : `排定 ${formatDateTime(wo.scheduledStartAt)}`}
                </p>
              </PilotCard>
            </li>
          ))}
        </ul>
      ) : (
        <PilotCard className="py-10 text-center">
          <p className="text-sm leading-6 text-ink-3">
            這台設備尚未有服務履歷。設備為選填，之後每次服務會自動累積在這裡。
          </p>
        </PilotCard>
      )}
    </PilotPage>
  );
}

function Row({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="flex justify-between gap-3">
      <dt>{label}</dt>
      <dd className="text-ink-2">{value ?? "—"}</dd>
    </div>
  );
}

"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { deleteProject } from "@/lib/actions";
import { formatCurrencyShort, tradeDateRange } from "@/lib/format";
import { TopBar, TopBarIconButton } from "@/components/ui/top-bar";
import { HeroCard } from "@/components/ui/hero-card";
import { EditProjectForm } from "@/components/edit-project-form";

type ProjectStatus = "planning" | "in_progress" | "completed";

const STATUS_LABEL: Record<ProjectStatus, string> = {
  planning: "規劃中",
  in_progress: "施工中",
  completed: "已完工",
};

export function ProjectHeader({
  project,
  trades,
  profitEstimate,
}: Readonly<{
  project: {
    id: string;
    customer_name: string;
    address: string;
    description: string;
    total_amount: number;
    status: ProjectStatus;
    progress: number;
  };
  trades: { start_date: string | null; end_date: string | null }[];
  profitEstimate: { profit: number; margin: number } | null;
}>) {
  const router = useRouter();
  const [showEdit, setShowEdit] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const handleDelete = async () => {
    if (
      !globalThis.confirm(
        "確定要刪除此案件嗎？所有相關的報價、工種、收款資料都會一併刪除。"
      )
    )
      return;
    setDeleting(true);
    try {
      await deleteProject(project.id);
      router.push("/dashboard");
    } catch {
      setDeleting(false);
      globalThis.alert("刪除失敗，請重試");
    }
  };

  const dateRange = tradeDateRange(trades);
  const subtitle = dateRange ?? STATUS_LABEL[project.status];

  const profitDisplay = profitEstimate
    ? {
        label: "利潤",
        value: formatCurrencyShort(profitEstimate.profit),
        sub: `${profitEstimate.margin.toFixed(0)}%`,
      }
    : {
        label: "利潤",
        value: "—",
        sub: "待估報價",
      };

  return (
    <>
      <TopBar
        title={
          <span>
            {project.customer_name} · {project.description || "案件"}
          </span>
        }
        subtitle={subtitle}
        back={
          <Link
            href="/dashboard"
            aria-label="返回案件列表"
            className="w-9 h-9 rounded-xl border border-warm-border bg-surface flex items-center justify-center text-ink-2"
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M15 18l-6-6 6-6" />
            </svg>
          </Link>
        }
        right={
          <>
            <TopBarIconButton
              onClick={() => setShowEdit((p) => !p)}
              ariaLabel={showEdit ? "取消編輯" : "編輯案件"}
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.9"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
              </svg>
            </TopBarIconButton>
            <TopBarIconButton
              variant="alert"
              onClick={handleDelete}
              ariaLabel="刪除案件"
            >
              {deleting ? (
                <span className="text-[11px]">…</span>
              ) : (
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <polyline points="3 6 5 6 21 6" />
                  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                </svg>
              )}
            </TopBarIconButton>
          </>
        }
      />

      <HeroCard
        eyebrow={project.address}
        title={`${project.customer_name} · ${project.description || "工程案件"}`}
        stats={[
          {
            label: "客戶總價",
            value: formatCurrencyShort(project.total_amount),
          },
          profitDisplay,
          { label: "進度", value: `${project.progress}%` },
        ]}
        progress={project.progress}
      />

      {showEdit && (
        <div className="px-4 pb-3">
          <EditProjectForm
            projectId={project.id}
            currentCustomerName={project.customer_name}
            currentAddress={project.address}
            currentDescription={project.description}
            onClose={() => setShowEdit(false)}
          />
        </div>
      )}
    </>
  );
}

"use client";

import { useState } from "react";
import { deleteProject } from "@/lib/actions";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { formatCurrency } from "@/lib/format";
import { EditProjectForm } from "@/components/edit-project-form";

export function ProjectHeader({
  project,
}: {
  project: {
    id: string;
    customer_name: string;
    address: string;
    description: string;
    total_amount: number;
  };
}) {
  const router = useRouter();
  const [showEdit, setShowEdit] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const handleDelete = async () => {
    if (!globalThis.confirm("確定要刪除此案件嗎？所有相關的報價、工種、收款資料都會一併刪除。")) return;

    setDeleting(true);
    try {
      await deleteProject(project.id);
      router.push("/");
    } catch {
      setDeleting(false);
      globalThis.alert("刪除失敗，請重試");
    }
  };

  return (
    <>
      <header className="bg-primary text-primary-foreground px-4 py-4">
        <div className="flex justify-between items-center mb-3">
          <Link
            href="/"
            className="flex items-center gap-1.5 text-sm py-1 opacity-80 hover:opacity-100 transition-opacity"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M15 18l-6-6 6-6" />
            </svg>
            返回列表
          </Link>
          <div className="flex gap-2">
            <button
              onClick={() => setShowEdit((prev) => !prev)}
              className="flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-full border border-white/30 opacity-90 hover:opacity-100 hover:bg-white/10 transition-all"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
              </svg>
              {showEdit ? "取消" : "編輯"}
            </button>
            <button
              onClick={handleDelete}
              disabled={deleting}
              className="flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-full border border-white/30 opacity-90 hover:opacity-100 hover:bg-red-500/20 transition-all disabled:opacity-50"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="3 6 5 6 21 6" />
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
              </svg>
              {deleting ? "..." : "刪除"}
            </button>
          </div>
        </div>
        <div className="text-xl font-bold">
          {project.customer_name} — {project.address}
        </div>
        <div className="text-sm opacity-80 mt-1">
          {project.description} · {formatCurrency(project.total_amount)}
        </div>
      </header>

      {showEdit && (
        <div className="p-4">
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

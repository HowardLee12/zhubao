"use client";

import { useState } from "react";
import { updateProject } from "@/lib/actions";
import { useRouter } from "next/navigation";

export function EditProjectForm({
  projectId,
  currentCustomerName,
  currentAddress,
  currentDescription,
  onClose,
}: {
  projectId: string;
  currentCustomerName: string;
  currentAddress: string;
  currentDescription: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const [form, setForm] = useState({
    customerName: currentCustomerName,
    address: currentAddress,
    description: currentDescription,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const updateField = (field: keyof typeof form, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const handleSave = async () => {
    if (!form.customerName.trim() || !form.address.trim()) return;

    setSaving(true);
    setError(null);
    try {
      await updateProject(projectId, {
        customerName: form.customerName.trim(),
        address: form.address.trim(),
        description: form.description.trim(),
      });
      onClose();
      router.refresh();
    } catch {
      setError("儲存失敗，請重試");
      setSaving(false);
    }
  };

  return (
    <div className="bg-card rounded-xl shadow-sm p-4 space-y-3">
      <div className="text-sm font-semibold text-sage-800">編輯案件資料</div>

      <div>
        <label className="text-[10px] text-muted-foreground">屋主姓名</label>
        <input
          type="text"
          value={form.customerName}
          onChange={(e) => updateField("customerName", e.target.value)}
          className="w-full px-3 py-2 rounded-lg border border-border text-sm focus:outline-none focus:ring-1 focus:ring-primary/30"
        />
      </div>

      <div>
        <label className="text-[10px] text-muted-foreground">案場地址</label>
        <input
          type="text"
          value={form.address}
          onChange={(e) => updateField("address", e.target.value)}
          className="w-full px-3 py-2 rounded-lg border border-border text-sm focus:outline-none focus:ring-1 focus:ring-primary/30"
        />
      </div>

      <div>
        <label className="text-[10px] text-muted-foreground">案件說明</label>
        <input
          type="text"
          value={form.description}
          onChange={(e) => updateField("description", e.target.value)}
          className="w-full px-3 py-2 rounded-lg border border-border text-sm focus:outline-none focus:ring-1 focus:ring-primary/30"
        />
      </div>

      {error && <div className="text-xs text-destructive">{error}</div>}

      <div className="flex gap-2">
        <button
          onClick={onClose}
          className="flex-1 py-2 rounded-lg border border-border text-sm text-muted-foreground"
        >
          取消
        </button>
        <button
          onClick={handleSave}
          disabled={saving || !form.customerName.trim() || !form.address.trim()}
          className="flex-1 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50"
        >
          {saving ? "儲存中..." : "儲存"}
        </button>
      </div>
    </div>
  );
}

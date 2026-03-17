"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createProject } from "@/lib/actions";

export default function NewProjectPage() {
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [form, setForm] = useState({
    customerName: "",
    address: "",
    description: "",
  });

  const updateField = (field: keyof typeof form, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.customerName.trim() || !form.address.trim()) return;

    setIsSubmitting(true);
    try {
      const project = await createProject({
        customerName: form.customerName.trim(),
        address: form.address.trim(),
        description: form.description.trim(),
      });
      router.push(`/projects/${project.id}`);
    } catch (err) {
      setIsSubmitting(false);
      throw err;
    }
  };

  return (
    <div>
      <header className="bg-primary text-primary-foreground px-4 py-3">
        <button onClick={() => router.back()} className="text-xs opacity-80">
          ← 返回
        </button>
        <div className="text-lg font-bold mt-1">新增案件</div>
      </header>

      <form onSubmit={handleSubmit} className="p-4 space-y-4">
        <div>
          <label className="block text-sm font-medium text-sage-800 mb-1">
            屋主姓名 *
          </label>
          <input
            type="text"
            value={form.customerName}
            onChange={(e) => updateField("customerName", e.target.value)}
            placeholder="例：林先生"
            className="w-full px-3 py-2.5 rounded-xl border border-border bg-card text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
            required
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-sage-800 mb-1">
            案場地址 *
          </label>
          <input
            type="text"
            value={form.address}
            onChange={(e) => updateField("address", e.target.value)}
            placeholder="例：信義路三段28號4F"
            className="w-full px-3 py-2.5 rounded-xl border border-border bg-card text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
            required
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-sage-800 mb-1">
            案件說明
          </label>
          <input
            type="text"
            value={form.description}
            onChange={(e) => updateField("description", e.target.value)}
            placeholder="例：3房2廳全室裝修"
            className="w-full px-3 py-2.5 rounded-xl border border-border bg-card text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
          />
        </div>

        <button
          type="submit"
          disabled={isSubmitting || !form.customerName.trim() || !form.address.trim()}
          className="w-full bg-primary text-primary-foreground py-3 rounded-xl font-semibold text-sm disabled:opacity-50"
        >
          {isSubmitting ? "建立中..." : "建立案件"}
        </button>
      </form>
    </div>
  );
}

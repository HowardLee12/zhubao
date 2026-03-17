"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { createQuoteWithSections } from "@/lib/actions";
import { formatCurrency, calculateClientPrice, calculateSectionTotal } from "@/lib/format";
import { v4 as uuid } from "uuid";
import { NumberInput } from "@/components/number-input";

interface DraftItem {
  id: string;
  name: string;
  spec: string;
  unit: string;
  quantity: number;
  unitCost: number;
  markupPercent: number;
}

interface DraftSection {
  id: string;
  name: string;
  icon: string;
  items: DraftItem[];
}

const COMMON_SECTIONS = [
  { name: "拆除工程", icon: "🔨" },
  { name: "水電工程", icon: "🔧" },
  { name: "泥作工程", icon: "🧱" },
  { name: "木作工程", icon: "🪵" },
  { name: "油漆工程", icon: "🎨" },
  { name: "鋁窗工程", icon: "🪟" },
  { name: "系統櫃", icon: "🗄️" },
  { name: "廚具工程", icon: "🍳" },
  { name: "衛浴工程", icon: "🚿" },
  { name: "地板工程", icon: "🏠" },
  { name: "清潔工程", icon: "🧹" },
  { name: "設計費", icon: "📐" },
  { name: "其他", icon: "📦" },
];

interface CloneQuoteData {
  sections: {
    name: string;
    icon: string;
    items: {
      name: string;
      spec: string;
      unit: string;
      quantity: number;
      unitCost: number;
      markupPercent: number;
    }[];
  }[];
}

export function InlineQuoteBuilder({
  projectId,
  cloneFromId,
  onClose,
}: {
  projectId: string;
  cloneFromId?: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const [sections, setSections] = useState<DraftSection[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [showAddSection, setShowAddSection] = useState(false);
  const [loadingClone, setLoadingClone] = useState(!!cloneFromId);

  const loadCloneData = useCallback(async () => {
    if (!cloneFromId) return;
    try {
      const res = await fetch(`/api/quotes/${cloneFromId}`);
      if (!res.ok) {
        setLoadingClone(false);
        return;
      }
      const data = (await res.json()) as CloneQuoteData;
      const clonedSections: DraftSection[] = data.sections.map((s) => ({
        id: uuid(),
        name: s.name,
        icon: s.icon,
        items: s.items.map((item) => ({
          id: uuid(),
          name: item.name,
          spec: item.spec,
          unit: item.unit,
          quantity: item.quantity,
          unitCost: item.unitCost,
          markupPercent: item.markupPercent,
        })),
      }));
      setSections(clonedSections);
    } catch {
      setSubmitError("載入報價資料失敗");
    } finally {
      setLoadingClone(false);
    }
  }, [cloneFromId]);

  useEffect(() => {
    loadCloneData();
  }, [loadCloneData]);

  if (loadingClone) {
    return (
      <div className="bg-card rounded-xl shadow-sm p-8 text-center text-muted-foreground text-sm">
        載入報價資料中...
      </div>
    );
  }

  const addSection = (name: string, icon: string) => {
    setSections((prev) => [
      ...prev,
      { id: uuid(), name, icon, items: [] },
    ]);
    setShowAddSection(false);
  };

  const removeSection = (sectionId: string) => {
    setSections((prev) => prev.filter((s) => s.id !== sectionId));
  };

  const addItem = (sectionId: string) => {
    setSections((prev) =>
      prev.map((s) =>
        s.id === sectionId
          ? {
              ...s,
              items: [
                ...s.items,
                {
                  id: uuid(),
                  name: "",
                  spec: "",
                  unit: "式",
                  quantity: 1,
                  unitCost: 0,
                  markupPercent: 40,
                },
              ],
            }
          : s
      )
    );
  };

  const updateItem = (sectionId: string, itemId: string, field: keyof DraftItem, value: string | number) => {
    setSections((prev) =>
      prev.map((s) =>
        s.id === sectionId
          ? {
              ...s,
              items: s.items.map((item) =>
                item.id === itemId ? { ...item, [field]: value } : item
              ),
            }
          : s
      )
    );
  };

  const removeItem = (sectionId: string, itemId: string) => {
    setSections((prev) =>
      prev.map((s) =>
        s.id === sectionId
          ? { ...s, items: s.items.filter((i) => i.id !== itemId) }
          : s
      )
    );
  };

  const handleClientPriceChange = (sectionId: string, itemId: string, clientPrice: number) => {
    setSections((prev) =>
      prev.map((s) =>
        s.id === sectionId
          ? {
              ...s,
              items: s.items.map((item) => {
                if (item.id !== itemId) return item;
                const newMarkup = item.unitCost > 0
                  ? Math.round(((clientPrice / item.unitCost) - 1) * 100 * 10) / 10
                  : 0;
                return { ...item, markupPercent: Math.max(0, newMarkup) };
              }),
            }
          : s
      )
    );
  };

  const costTotal = sections.reduce(
    (sum, section) => sum + calculateSectionTotal(section.items, "cost"),
    0
  );
  const clientTotal = sections.reduce(
    (sum, section) => sum + calculateSectionTotal(section.items, "client"),
    0
  );
  const profit = clientTotal - costTotal;
  const profitMargin = clientTotal > 0 ? ((profit / clientTotal) * 100).toFixed(1) : "0";

  const handleSubmit = async () => {
    const validSections = sections.filter((s) => s.items.length > 0);
    if (validSections.length === 0) return;

    setIsSubmitting(true);
    setSubmitError(null);
    try {
      await createQuoteWithSections({
        projectId,
        sections: validSections.map((s) => ({
          name: s.name,
          icon: s.icon,
          items: s.items
            .filter((i) => i.name.trim())
            .map((i) => ({
              name: i.name.trim(),
              spec: i.spec.trim(),
              unit: i.unit,
              quantity: i.quantity,
              unitCost: i.unitCost,
              markupPercent: i.markupPercent,
            })),
        })),
      });
      onClose();
      router.refresh();
    } catch (err) {
      setIsSubmitting(false);
      setSubmitError(err instanceof Error ? err.message : "儲存失敗，請重試");
    }
  };

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div className="text-sm font-semibold text-sage-800">
          {cloneFromId ? "建立新版本報價" : "建立報價單"}
        </div>
        <button onClick={onClose} className="text-xs text-muted-foreground">
          取消
        </button>
      </div>

      {/* Profit summary */}
      {sections.some((s) => s.items.length > 0) && (
        <div className="bg-sage-700 text-white rounded-xl p-3 flex justify-between items-center">
          <div>
            <div className="text-[11px] opacity-80">成本</div>
            <div className="text-sm font-bold">{formatCurrency(costTotal)}</div>
          </div>
          <div className="text-center">
            <div className="text-[11px] opacity-80">利潤</div>
            <div className="text-sm font-bold">{formatCurrency(profit)}</div>
          </div>
          <div className="text-right">
            <div className="text-[11px] opacity-80">毛利率</div>
            <div className="text-sm font-bold">{profitMargin}%</div>
          </div>
        </div>
      )}

      {/* Sections */}
      {sections.map((section) => (
        <div key={section.id} className="bg-white rounded-xl shadow-sm overflow-hidden border border-sage-100">
          <div className="px-4 py-2.5 bg-sage-100 flex justify-between items-center">
            <span className="text-sm font-semibold text-sage-800">
              {section.icon} {section.name}
            </span>
            <div className="flex gap-2">
              <button
                onClick={() => addItem(section.id)}
                className="text-xs text-primary font-medium"
              >
                + 項目
              </button>
              <button
                onClick={() => removeSection(section.id)}
                className="text-xs text-destructive font-medium"
              >
                刪除
              </button>
            </div>
          </div>

          {section.items.length === 0 && (
            <div className="p-4 text-center text-muted-foreground text-xs">
              <button onClick={() => addItem(section.id)} className="text-primary font-medium">
                + 新增第一個項目
              </button>
            </div>
          )}

          {section.items.map((item) => (
            <div key={item.id} className="px-4 py-3 border-b border-sage-50 last:border-0">
              <div className="flex gap-2 mb-2">
                <input
                  type="text"
                  value={item.name}
                  onChange={(e) => updateItem(section.id, item.id, "name", e.target.value)}
                  placeholder="項目名稱"
                  className="flex-1 px-2 py-1.5 rounded-lg border border-border text-sm focus:outline-none focus:ring-1 focus:ring-primary/30"
                />
                <button
                  onClick={() => removeItem(section.id, item.id)}
                  className="text-destructive text-xs px-2"
                >
                  {"✕"}
                </button>
              </div>

              <input
                type="text"
                value={item.spec}
                onChange={(e) => updateItem(section.id, item.id, "spec", e.target.value)}
                placeholder="規格說明（例：約32坪、含安裝）"
                className="w-full px-2 py-1.5 rounded-lg border border-border text-xs text-muted-foreground mb-2 focus:outline-none focus:ring-1 focus:ring-primary/30"
              />

              {/* Row 1: 數量、單位、成本單價 */}
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="text-[10px] text-muted-foreground">數量</label>
                  <NumberInput
                    value={item.quantity}
                    onChange={(v) => updateItem(section.id, item.id, "quantity", v)}
                    min={0}
                    step={0.5}
                    className="w-full px-2 py-1.5 rounded-lg border border-border text-xs focus:outline-none focus:ring-1 focus:ring-primary/30"
                  />
                </div>
                <div>
                  <label className="text-[10px] text-muted-foreground">單位</label>
                  <select
                    value={item.unit}
                    onChange={(e) => updateItem(section.id, item.id, "unit", e.target.value)}
                    className="w-full px-2 py-1.5 rounded-lg border border-border text-xs focus:outline-none"
                  >
                    <option value="式">式</option>
                    <option value="坪">坪</option>
                    <option value="尺">尺</option>
                    <option value="組">組</option>
                    <option value="個">個</option>
                    <option value="面">面</option>
                    <option value="間">間</option>
                    <option value="車">車</option>
                    <option value="天">天</option>
                  </select>
                </div>
                <div>
                  <label className="text-[10px] text-muted-foreground">成本單價</label>
                  <NumberInput
                    value={item.unitCost}
                    onChange={(v) => updateItem(section.id, item.id, "unitCost", v)}
                    min={0}
                    className="w-full px-2 py-1.5 rounded-lg border border-border text-xs focus:outline-none focus:ring-1 focus:ring-primary/30"
                  />
                </div>
              </div>

              {/* Row 2: 加價%、報客單價 (雙向計算) */}
              <div className="grid grid-cols-2 gap-2 mt-2">
                <div>
                  <label className="text-[10px] text-muted-foreground">加價 %</label>
                  <NumberInput
                    value={item.markupPercent}
                    onChange={(v) => updateItem(section.id, item.id, "markupPercent", v)}
                    min={0}
                    max={500}
                    className="w-full px-2 py-1.5 rounded-lg border border-border text-xs focus:outline-none focus:ring-1 focus:ring-primary/30"
                  />
                </div>
                <div>
                  <label className="text-[10px] text-muted-foreground">報客單價</label>
                  <NumberInput
                    value={calculateClientPrice(item.unitCost, item.markupPercent)}
                    onChange={(v) => handleClientPriceChange(section.id, item.id, v)}
                    min={0}
                    className="w-full px-2 py-1.5 rounded-lg border border-sage-200 bg-sage-50 text-xs font-medium text-sage-700 focus:outline-none focus:ring-1 focus:ring-primary/30"
                  />
                </div>
              </div>

              <div className="flex justify-between mt-2 text-[11px]">
                <span className="text-muted-foreground">
                  成本小計 {formatCurrency(item.unitCost * item.quantity)}
                </span>
                <span className="text-sage-700 font-medium">
                  報客小計 {formatCurrency(calculateClientPrice(item.unitCost, item.markupPercent) * item.quantity)}
                </span>
              </div>
            </div>
          ))}
        </div>
      ))}

      {/* Add section button */}
      {!showAddSection ? (
        <button
          onClick={() => setShowAddSection(true)}
          className="w-full py-3 border-2 border-dashed border-sage-300 rounded-xl text-sm text-sage-500 font-medium"
        >
          + 新增工程分類
        </button>
      ) : (
        <div className="bg-card rounded-xl shadow-sm p-4">
          <div className="text-sm font-semibold text-sage-800 mb-3">選擇工程分類</div>
          <div className="grid grid-cols-3 gap-2">
            {COMMON_SECTIONS.filter(
              (cs) => !sections.some((s) => s.name === cs.name)
            ).map((cs) => (
              <button
                key={cs.name}
                onClick={() => addSection(cs.name, cs.icon)}
                className="py-2 px-2 bg-sage-50 rounded-lg text-xs text-sage-700 font-medium hover:bg-sage-100 transition-colors"
              >
                {cs.icon} {cs.name}
              </button>
            ))}
          </div>
          <button
            onClick={() => setShowAddSection(false)}
            className="w-full mt-3 text-xs text-muted-foreground"
          >
            取消
          </button>
        </div>
      )}

      {/* Footer total + submit */}
      {sections.some((s) => s.items.length > 0) && (
        <div className="space-y-3">
          <div className="bg-card rounded-xl shadow-sm p-4">
            <div className="flex justify-between items-center">
              <span className="text-[13px] text-muted-foreground">成本總計</span>
              <span className="text-sm font-semibold">{formatCurrency(costTotal)}</span>
            </div>
            <div className="flex justify-between items-center mt-1">
              <span className="text-base font-bold">報客總價</span>
              <span className="text-lg font-bold text-primary">{formatCurrency(clientTotal)}</span>
            </div>
          </div>

          {submitError && (
            <div className="text-destructive text-xs text-center">{submitError}</div>
          )}

          <button
            onClick={handleSubmit}
            disabled={isSubmitting}
            className="w-full bg-primary text-primary-foreground py-3 rounded-xl font-semibold text-sm disabled:opacity-50"
          >
            {isSubmitting ? "儲存中..." : "儲存報價單"}
          </button>
        </div>
      )}
    </div>
  );
}

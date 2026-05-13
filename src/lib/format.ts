export function formatCurrency(amount: number): string {
  return `NT$${amount.toLocaleString("zh-TW")}`;
}

// Compact: 1,200,000 -> "120 萬", 8,500 -> "8,500"
export function formatCurrencyShort(amount: number): string {
  if (amount >= 10000) {
    const wan = Math.round((amount / 10000) * 10) / 10;
    return `NT$ ${wan} 萬`;
  }
  return `NT$ ${amount.toLocaleString("zh-TW")}`;
}

export function formatDate(dateStr: string): string {
  if (!dateStr) return "待定";
  const date = new Date(dateStr);
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

const WEEKDAYS_ZH = ["日", "一", "二", "三", "四", "五", "六"];

// "2026-05-13" -> "5月13日 週三"
export function formatDateLong(date: Date = new Date()): string {
  return `${date.getMonth() + 1}月${date.getDate()}日 週${WEEKDAYS_ZH[date.getDay()]}`;
}

export function greeting(date: Date = new Date()): string {
  const h = date.getHours();
  if (h < 5) return "深夜辛苦了";
  if (h < 11) return "早安";
  if (h < 14) return "午安";
  if (h < 18) return "下午好";
  return "晚安";
}

export function calculateClientPrice(unitCost: number, markupPercent: number): number {
  return Math.round(unitCost * (1 + markupPercent / 100));
}

export function calculateSectionTotal(
  items: { unitCost: number; quantity: number; markupPercent: number }[],
  mode: "cost" | "client"
): number {
  return items.reduce((sum, item) => {
    const price = mode === "cost"
      ? item.unitCost * item.quantity
      : calculateClientPrice(item.unitCost, item.markupPercent) * item.quantity;
    return sum + price;
  }, 0);
}

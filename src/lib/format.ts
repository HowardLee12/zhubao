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

// "2026-05-13" -> "今天 · 5/13 週三", "2026-05-14" -> "明天 · 5/14 週四",
// otherwise "5/13 週三"
export function formatScheduleDate(dateStr: string, today: string): string {
  const date = new Date(dateStr);
  if (Number.isNaN(date.getTime())) return dateStr;
  const md = `${date.getMonth() + 1}/${date.getDate()} 週${WEEKDAYS_ZH[date.getDay()]}`;

  const todayDate = new Date(today);
  const tomorrowStr = new Date(todayDate.getTime() + 86400000).toISOString().slice(0, 10);

  if (dateStr === today) return `今天 · ${md}`;
  if (dateStr === tomorrowStr) return `明天 · ${md}`;
  return md;
}

// Trades' min start_date and max end_date → "5/18 → 6/30" or "5/18 起" or null
export function tradeDateRange(
  trades: { start_date: string | null; end_date: string | null }[]
): string | null {
  const starts = trades.map((t) => t.start_date).filter(Boolean) as string[];
  const ends = trades.map((t) => t.end_date ?? t.start_date).filter(Boolean) as string[];
  if (starts.length === 0) return null;

  const cmp = (a: string, b: string) => a.localeCompare(b);
  const sortedStarts = [...starts].sort(cmp);
  const sortedEnds = [...ends].sort(cmp);
  const min = sortedStarts[0];
  const max = sortedEnds.at(-1);

  const fmt = (iso: string) => {
    const d = new Date(`${iso}T00:00:00`);
    return `${d.getMonth() + 1}/${d.getDate()}`;
  };

  if (!max || min === max) return `${fmt(min)} 起`;
  return `${fmt(min)} → ${fmt(max)}`;
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

export function formatCurrency(amount: number): string {
  return `NT$${amount.toLocaleString("zh-TW")}`;
}

export function formatDate(dateStr: string): string {
  if (!dateStr) return "待定";
  const date = new Date(dateStr);
  return `${date.getMonth() + 1}/${date.getDate()}`;
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

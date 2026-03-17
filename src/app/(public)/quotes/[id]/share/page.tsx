import { notFound } from "next/navigation";
import { getQuote } from "@/lib/queries";
import { supabase } from "@/lib/supabase";
import { formatCurrency, calculateClientPrice, calculateSectionTotal } from "@/lib/format";
import type { ProjectRow } from "@/lib/database.types";

export default async function QuoteSharePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const quote = await getQuote(id);

  if (!quote) notFound();

  const { data: projectData } = await supabase
    .from("projects")
    .select("*")
    .eq("id", quote.project_id)
    .single();

  const project = projectData as ProjectRow | null;
  const customerName = project?.customer_name ?? "";
  const address = project?.address ?? "";

  const sections = quote.sections.map((section) => ({
    ...section,
    items: section.items.map((item) => ({
      ...item,
      quantity: Number(item.quantity),
      markupPercent: Number(item.markup_percent),
    })),
  }));

  const grandTotal = sections.reduce(
    (sum, section) =>
      sum +
      section.items.reduce(
        (s, item) => s + calculateClientPrice(item.unit_cost, item.markupPercent) * item.quantity,
        0
      ),
    0
  );

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="bg-primary text-primary-foreground px-4 py-4">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-xs font-medium opacity-80">築報</span>
        </div>
        <div className="text-lg font-bold">報價單</div>
        <div className="text-xs opacity-80">
          {customerName} {address} · v{quote.version}
        </div>
      </header>

      {/* Sections */}
      <div className="px-4 pt-4 space-y-3">
        {sections.map((section) => {
          const sectionTotal = section.items.reduce(
            (sum, item) => sum + calculateClientPrice(item.unit_cost, item.markupPercent) * item.quantity,
            0
          );

          return (
            <div key={section.id} className="bg-card rounded-xl shadow-sm overflow-hidden">
              <div className="px-4 py-2.5 bg-sage-100 flex justify-between items-center">
                <span className="text-sm font-semibold text-sage-800">
                  {section.icon} {section.name}
                </span>
                <span className="text-sm font-semibold text-sage-700">
                  {formatCurrency(sectionTotal)}
                </span>
              </div>
              <div className="divide-y divide-sage-50">
                {section.items.map((item) => {
                  const price = calculateClientPrice(item.unit_cost, item.markupPercent) * item.quantity;
                  return (
                    <div key={item.id} className="px-4 py-2.5 flex justify-between items-center">
                      <div className="min-w-0 flex-1">
                        <div className="text-[13px]">{item.name}</div>
                        {item.spec && (
                          <div className="text-[11px] text-muted-foreground">{item.spec}</div>
                        )}
                        <div className="text-[11px] text-muted-foreground">
                          {item.quantity} {item.unit}
                          {item.quantity > 1 && (
                            <span> × {formatCurrency(calculateClientPrice(item.unit_cost, item.markupPercent))}</span>
                          )}
                        </div>
                      </div>
                      <div className="text-[13px] font-semibold shrink-0 ml-3">
                        {formatCurrency(price)}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {/* Total */}
      <div className="mx-4 my-4 bg-card rounded-xl shadow-sm p-4 flex justify-between items-center">
        <span className="text-base font-bold">工程總價</span>
        <span className="text-lg font-bold text-primary">{formatCurrency(grandTotal)}</span>
      </div>

      {/* Footer */}
      <div className="px-4 pb-8 text-center">
        <div className="text-[11px] text-muted-foreground">
          由築報產生 · 裝潢工程報價與管理工具
        </div>
      </div>
    </div>
  );
}

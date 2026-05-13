import { notFound } from "next/navigation";
import { getQuote } from "@/lib/queries";
import { supabase } from "@/lib/supabase";
import { formatCurrency, calculateClientPrice } from "@/lib/format";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Pre-compute client prices so cost data never enters the render tree
function toClientView(quote: NonNullable<Awaited<ReturnType<typeof getQuote>>>) {
  return quote.sections.map((section) => ({
    id: section.id,
    name: section.name,
    icon: section.icon,
    items: section.items.map((item) => {
      const clientUnitPrice = calculateClientPrice(item.unit_cost, Number(item.markup_percent));
      const quantity = Number(item.quantity);
      return {
        id: item.id,
        name: item.name,
        spec: item.spec,
        unit: item.unit,
        quantity,
        clientUnitPrice,
        clientTotal: clientUnitPrice * quantity,
      };
    }),
  }));
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_RE.test(id)) return { title: "報價單" };

  const quote = await getQuote(id);
  if (!quote) return { title: "報價單" };

  return {
    title: `報價單 v${quote.version} — Renoly`,
    description: "裝修工程報價明細",
  };
}

export default async function QuoteSharePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!UUID_RE.test(id)) notFound();

  const quote = await getQuote(id);
  if (!quote) notFound();

  const { data: projectData } = await supabase
    .from("projects")
    .select("customer_name, address")
    .eq("id", quote.project_id)
    .single();

  const customerName = projectData?.customer_name ?? "";
  const address = projectData?.address ?? "";

  // Only client-safe data from here
  const sections = toClientView(quote);
  const grandTotal = sections.reduce(
    (sum, section) => section.items.reduce((s, item) => s + item.clientTotal, sum),
    0
  );

  return (
    <div className="min-h-screen bg-background">
      <header className="bg-primary text-primary-foreground px-4 py-4">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-xs font-medium opacity-80">Renoly</span>
        </div>
        <div className="text-lg font-bold">報價單</div>
        <div className="text-xs opacity-80">
          {customerName} {address} · v{quote.version}
        </div>
      </header>

      <div className="px-4 pt-4 space-y-3">
        {sections.map((section) => {
          const sectionTotal = section.items.reduce((sum, item) => sum + item.clientTotal, 0);

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
                {section.items.map((item) => (
                  <div key={item.id} className="px-4 py-2.5 flex justify-between items-center">
                    <div className="min-w-0 flex-1">
                      <div className="text-[13px]">{item.name}</div>
                      {item.spec && (
                        <div className="text-[11px] text-muted-foreground">{item.spec}</div>
                      )}
                      <div className="text-[11px] text-muted-foreground">
                        {item.quantity} {item.unit}
                        {item.quantity > 1 && (
                          <span> × {formatCurrency(item.clientUnitPrice)}</span>
                        )}
                      </div>
                    </div>
                    <div className="text-[13px] font-semibold shrink-0 ml-3">
                      {formatCurrency(item.clientTotal)}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      <div className="mx-4 my-4 bg-card rounded-xl shadow-sm p-4 flex justify-between items-center">
        <span className="text-base font-bold">工程總價</span>
        <span className="text-lg font-bold text-primary">{formatCurrency(grandTotal)}</span>
      </div>

      <div className="px-4 pb-8 text-center">
        <div className="text-[11px] text-muted-foreground">
          由 Renoly 產生 · 裝修工程報價與管理工具
        </div>
      </div>
    </div>
  );
}

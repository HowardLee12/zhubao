import { createElement, type ReactElement } from "react";
import { renderToBuffer, type DocumentProps } from "@react-pdf/renderer";
import { getQuote, getUserProfile } from "@/lib/queries";
import { supabase } from "@/lib/supabase";
import { calculateClientPrice } from "@/lib/format";
import { QuoteDocument, type QuotePDFData } from "@/lib/pdf/quote-document";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  if (!UUID_RE.test(id)) {
    return new Response(JSON.stringify({ error: "Invalid id" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const quote = await getQuote(id);
  if (!quote) {
    return new Response(JSON.stringify({ error: "Not found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  const [{ data: projectData }, profile] = await Promise.all([
    supabase
      .from("projects")
      .select("customer_name, address, description")
      .eq("id", quote.project_id)
      .single(),
    getUserProfile().catch(() => null),
  ]);

  const customerName = projectData?.customer_name ?? "";
  const address = projectData?.address ?? "";
  const description = projectData?.description ?? "";

  // Pre-compute client prices — cost/markup never enters the PDF render tree.
  const sections = quote.sections.map((s) => ({
    name: s.name,
    icon: s.icon,
    items: s.items.map((item) => {
      const clientUnitPrice = calculateClientPrice(
        item.unit_cost,
        Number(item.markup_percent)
      );
      const quantity = Number(item.quantity);
      return {
        name: item.name,
        spec: item.spec,
        unit: item.unit,
        quantity,
        clientUnitPrice,
        clientTotal: clientUnitPrice * quantity,
      };
    }),
  }));

  const grandTotal = sections.reduce(
    (sum, s) => s.items.reduce((acc, it) => acc + it.clientTotal, sum),
    0
  );

  const todayDate = new Date();
  const generatedDate = `${todayDate.getFullYear()}-${String(todayDate.getMonth() + 1).padStart(2, "0")}-${String(todayDate.getDate()).padStart(2, "0")}`;

  const data: QuotePDFData = {
    customerName,
    address,
    description,
    version: quote.version,
    designerName: profile?.display_name ?? "",
    generatedDate,
    sections,
    grandTotal,
  };

  // QuoteDocument wraps <Document>, but TS can't infer the underlying
  // DocumentProps through a function component, so cast explicitly.
  const element = createElement(QuoteDocument, { data }) as unknown as ReactElement<DocumentProps>;
  const buffer = await renderToBuffer(element);

  const filename = `${customerName || "報價單"}-v${quote.version}.pdf`;
  // RFC 5987-encoded filename for non-ASCII chars
  const encoded = encodeURIComponent(filename);

  return new Response(buffer as unknown as BodyInit, {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename*=UTF-8''${encoded}`,
      "Cache-Control": "private, no-store",
    },
  });
}

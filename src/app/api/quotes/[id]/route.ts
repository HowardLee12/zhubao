import { NextResponse } from "next/server";
import { getQuote } from "@/lib/queries";
import { supabase } from "@/lib/supabase";
import { ProjectRow } from "@/lib/database.types";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const quote = await getQuote(id);

  if (!quote) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const { data } = await supabase
    .from("projects")
    .select("*")
    .eq("id", quote.project_id)
    .single();

  const project = data;

  return NextResponse.json({
    id: quote.id,
    projectId: quote.project_id,
    version: quote.version,
    customerName: project?.customer_name ?? "",
    address: project?.address ?? "",
    sections: quote.sections.map((section) => ({
      id: section.id,
      name: section.name,
      icon: section.icon,
      items: section.items.map((item) => ({
        id: item.id,
        name: item.name,
        spec: item.spec,
        unit: item.unit,
        quantity: Number(item.quantity),
        unitCost: item.unit_cost,
        markupPercent: Number(item.markup_percent),
      })),
    })),
  });
}

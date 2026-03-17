import { NextResponse } from "next/server";
import { getQuote } from "@/lib/queries";
import { supabase } from "@/lib/supabase";
import { getUserId } from "@/lib/auth";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const userId = await getUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const quote = await getQuote(id);
  if (!quote) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Verify quote belongs to this user's project
  const { data: project } = await supabase
    .from("projects")
    .select("customer_name, address")
    .eq("id", quote.project_id)
    .eq("user_id", userId)
    .single();

  if (!project) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json({
    id: quote.id,
    projectId: quote.project_id,
    version: quote.version,
    customerName: project.customer_name ?? "",
    address: project.address ?? "",
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

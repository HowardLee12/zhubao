"use server";

import { supabase, supabaseAdmin } from "./supabase";
import { revalidatePath } from "next/cache";
import { ProjectRow, QuoteRow } from "./database.types";
import { getUserId } from "./auth";
import { canCreateQuote, canCreateProject } from "./queries";

// ===== Projects =====

export async function createProject(data: {
  customerName: string;
  address: string;
  description: string;
}): Promise<ProjectRow> {
  const userId = await getUserId();
  if (!userId) throw new Error("請先登入");

  const allowed = await canCreateProject();
  if (!allowed) {
    throw new Error("免費方案最多建立 1 個案件，請升級為專業版");
  }

  const { data: project, error } = await supabase
    .from("projects")
    .insert({
      customer_name: data.customerName,
      address: data.address,
      description: data.description,
      total_amount: 0,
      status: "planning" as const,
      progress: 0,
      user_id: userId,
    })
    .select()
    .single();

  if (error) throw new Error(`Failed to create project: ${error.message}`);

  revalidatePath("/");
  return project;
}

export async function updateProject(
  id: string,
  data: {
    customerName?: string;
    address?: string;
    description?: string;
    status?: "planning" | "in_progress" | "completed";
    progress?: number;
  }
) {
  const updateData: Record<string, unknown> = {};
  if (data.customerName !== undefined) updateData.customer_name = data.customerName;
  if (data.address !== undefined) updateData.address = data.address;
  if (data.description !== undefined) updateData.description = data.description;
  if (data.status !== undefined) updateData.status = data.status;
  if (data.progress !== undefined) updateData.progress = data.progress;

  const userId = await getUserId();
  if (!userId) throw new Error("請先登入");

  const { error } = await supabase
    .from("projects")
    .update(updateData)
    .eq("id", id)
    .eq("user_id", userId);

  if (error) throw new Error(`Failed to update project: ${error.message}`);

  revalidatePath("/");
  revalidatePath(`/projects/${id}`);
}

export async function deleteProject(id: string) {
  const userId = await getUserId();
  if (!userId) throw new Error("請先登入");

  // Clean up photos from storage before cascading delete
  const storagePath = `${userId}/${id}`;
  const { data: files } = await supabaseAdmin.storage.from("photos").list(storagePath);
  if (files && files.length > 0) {
    const paths = files.map((f) => `${storagePath}/${f.name}`);
    await supabaseAdmin.storage.from("photos").remove(paths);
  }

  const { error } = await supabase
    .from("projects")
    .delete()
    .eq("id", id)
    .eq("user_id", userId);

  if (error) throw new Error(`Failed to delete project: ${error.message}`);
  revalidatePath("/");
}

// ===== Quotes =====

export async function createQuoteWithSections(data: {
  projectId: string;
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
}): Promise<{ data?: QuoteRow; error?: string }> {
  // Check quota for free users
  const allowed = await canCreateQuote();
  if (!allowed) {
    return { error: "免費方案最多建立 1 張報價單，請升級為專業版" };
  }

  // Get next version number
  const { data: existing } = await supabase
    .from("quotes")
    .select("version")
    .eq("project_id", data.projectId)
    .order("version", { ascending: false })
    .limit(1);

  const nextVersion = (existing?.[0]?.version ?? 0) + 1;

  // Create quote
  const { data: quote, error: quoteError } = await supabase
    .from("quotes")
    .insert({
      project_id: data.projectId,
      version: nextVersion,
      notes: "",
    })
    .select()
    .single();

  if (quoteError) return { error: `建立報價單失敗: ${quoteError.message}` };

  // Create sections and items
  for (let si = 0; si < data.sections.length; si++) {
    const section = data.sections[si];
    const { data: sectionRow, error: sectionError } = await supabase
      .from("quote_sections")
      .insert({
        quote_id: quote.id,
        name: section.name,
        icon: section.icon,
        sort_order: si,
      })
      .select()
      .single();

    if (sectionError) return { error: `建立分類失敗: ${sectionError.message}` };

    if (section.items.length > 0) {
      const itemRows = section.items.map((item, ii) => ({
        section_id: sectionRow.id,
        name: item.name,
        spec: item.spec,
        unit: item.unit,
        quantity: item.quantity,
        unit_cost: item.unitCost,
        markup_percent: item.markupPercent,
        sort_order: ii,
      }));

      const { error: itemsError } = await supabase
        .from("quote_items")
        .insert(itemRows);

      if (itemsError) return { error: `建立項目失敗: ${itemsError.message}` };
    }
  }

  // Update project total_amount
  await recalculateProjectTotal(data.projectId);

  revalidatePath("/quotes");
  revalidatePath(`/quotes/${quote.id}`);
  return { data: quote };
}

export async function addQuoteItem(data: {
  sectionId: string;
  name: string;
  spec: string;
  unit: string;
  quantity: number;
  unitCost: number;
  markupPercent: number;
}) {
  // Get next sort_order
  const { data: existing } = await supabase
    .from("quote_items")
    .select("sort_order")
    .eq("section_id", data.sectionId)
    .order("sort_order", { ascending: false })
    .limit(1);

  const nextOrder = (existing?.[0]?.sort_order ?? -1) + 1;

  const { data: item, error } = await supabase
    .from("quote_items")
    .insert({
      section_id: data.sectionId,
      name: data.name,
      spec: data.spec,
      unit: data.unit,
      quantity: data.quantity,
      unit_cost: data.unitCost,
      markup_percent: data.markupPercent,
      sort_order: nextOrder,
    })
    .select()
    .single();

  if (error) throw new Error(`Failed to add item: ${error.message}`);

  revalidatePath("/quotes");
  return item;
}

export async function updateQuoteItem(
  itemId: string,
  data: {
    name?: string;
    spec?: string;
    unit?: string;
    quantity?: number;
    unitCost?: number;
    markupPercent?: number;
  }
) {
  const updateData: Record<string, unknown> = {};
  if (data.name !== undefined) updateData.name = data.name;
  if (data.spec !== undefined) updateData.spec = data.spec;
  if (data.unit !== undefined) updateData.unit = data.unit;
  if (data.quantity !== undefined) updateData.quantity = data.quantity;
  if (data.unitCost !== undefined) updateData.unit_cost = data.unitCost;
  if (data.markupPercent !== undefined) updateData.markup_percent = data.markupPercent;

  const { error } = await supabase
    .from("quote_items")
    .update(updateData)
    .eq("id", itemId);

  if (error) throw new Error(`Failed to update item: ${error.message}`);
  revalidatePath("/quotes");
}

export async function deleteQuoteItem(itemId: string) {
  const { error } = await supabase
    .from("quote_items")
    .delete()
    .eq("id", itemId);

  if (error) throw new Error(`Failed to delete item: ${error.message}`);
  revalidatePath("/quotes");
}

// ===== Payments =====

export async function addPayment(data: {
  projectId: string;
  name: string;
  percentage: number;
  amount: number;
  dueDate?: string;
}) {
  const { data: existing } = await supabase
    .from("payments")
    .select("sort_order")
    .eq("project_id", data.projectId)
    .order("sort_order", { ascending: false })
    .limit(1);

  const nextOrder = (existing?.[0]?.sort_order ?? -1) + 1;

  const { error } = await supabase
    .from("payments")
    .insert({
      project_id: data.projectId,
      name: data.name,
      percentage: data.percentage,
      amount: data.amount,
      due_date: data.dueDate ?? null,
      status: "pending",
      sort_order: nextOrder,
    });

  if (error) throw new Error(`Failed to add payment: ${error.message}`);
  revalidatePath("/payments");
  revalidatePath(`/projects/${data.projectId}`);
}

export async function updatePaymentStatus(
  paymentId: string,
  status: "paid" | "due" | "upcoming" | "pending",
  paidDate?: string
) {
  const updateData: Record<string, unknown> = { status };
  if (status === "paid") {
    updateData.paid_date = paidDate ?? new Date().toISOString().split("T")[0];
  } else {
    updateData.paid_date = null;
  }

  const { error } = await supabase
    .from("payments")
    .update(updateData)
    .eq("id", paymentId);

  if (error) throw new Error(`Failed to update payment: ${error.message}`);
  revalidatePath("/payments");
}

export async function deletePayment(paymentId: string, projectId: string) {
  const { error } = await supabase
    .from("payments")
    .delete()
    .eq("id", paymentId);

  if (error) throw new Error(`Failed to delete payment: ${error.message}`);
  revalidatePath(`/projects/${projectId}`);
  revalidatePath("/payments");
}

// ===== Trades =====

export async function updateTrade(
  tradeId: string,
  data: {
    status?: "pending" | "active" | "done";
    crew?: string;
    crewId?: string | null;
    startDate?: string | null;
    endDate?: string | null;
    projectId?: string;
  }
) {
  const updateData: Record<string, unknown> = {};
  if (data.status !== undefined) updateData.status = data.status;
  if (data.crew !== undefined) updateData.crew = data.crew;
  if (data.crewId !== undefined) updateData.crew_id = data.crewId;
  if (data.startDate !== undefined) updateData.start_date = data.startDate;
  if (data.endDate !== undefined) updateData.end_date = data.endDate;

  const { error } = await supabase
    .from("trades")
    .update(updateData)
    .eq("id", tradeId);

  if (error) throw new Error(`Failed to update trade: ${error.message}`);
  revalidatePath("/schedule");
  if (data.projectId) {
    revalidatePath(`/projects/${data.projectId}`);
  }
}

export async function deleteTrade(tradeId: string, projectId: string) {
  const { error } = await supabase
    .from("trades")
    .delete()
    .eq("id", tradeId);

  if (error) throw new Error(`Failed to delete trade: ${error.message}`);
  revalidatePath(`/projects/${projectId}`);
  revalidatePath("/schedule");
}

export async function addTrade(data: {
  projectId: string;
  name: string;
  crew: string;
  crewId?: string | null;
  startDate?: string;
  endDate?: string;
}) {
  const { data: existing } = await supabase
    .from("trades")
    .select("sort_order")
    .eq("project_id", data.projectId)
    .order("sort_order", { ascending: false })
    .limit(1);

  const nextOrder = (existing?.[0]?.sort_order ?? -1) + 1;

  const { error } = await supabase
    .from("trades")
    .insert({
      project_id: data.projectId,
      name: data.name,
      crew: data.crew,
      crew_id: data.crewId ?? null,
      start_date: data.startDate ?? null,
      end_date: data.endDate ?? null,
      status: "pending",
      sort_order: nextOrder,
    });

  if (error) throw new Error(`Failed to add trade: ${error.message}`);
  revalidatePath(`/projects/${data.projectId}`);
  revalidatePath("/schedule");
}

// ===== Crews =====

export async function createCrew(data: {
  name: string;
  role: string;
  phone: string;
}) {
  const userId = await getUserId();
  if (!userId) throw new Error("請先登入");

  const trimmed = {
    name: data.name.trim(),
    role: data.role.trim(),
    phone: data.phone.trim(),
  };
  if (!trimmed.name) throw new Error("工班名稱不能空白");

  const { data: crew, error } = await supabase
    .from("crews")
    .insert({
      user_id: userId,
      name: trimmed.name,
      role: trimmed.role,
      phone: trimmed.phone,
    })
    .select()
    .single();

  if (error) throw new Error(`新增工班失敗: ${error.message}`);

  revalidatePath("/account/crews");
  revalidatePath("/schedule");
  return crew;
}

export async function updateCrew(
  crewId: string,
  data: { name?: string; role?: string; phone?: string; hiddenInSchedule?: boolean }
) {
  const userId = await getUserId();
  if (!userId) throw new Error("請先登入");

  const updateData: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (data.name !== undefined) updateData.name = data.name.trim();
  if (data.role !== undefined) updateData.role = data.role.trim();
  if (data.phone !== undefined) updateData.phone = data.phone.trim();
  if (data.hiddenInSchedule !== undefined) updateData.hidden_in_schedule = data.hiddenInSchedule;

  const { error } = await supabase
    .from("crews")
    .update(updateData)
    .eq("id", crewId)
    .eq("user_id", userId);

  if (error) throw new Error(`更新工班失敗: ${error.message}`);
  revalidatePath("/account/crews");
  revalidatePath("/schedule");
}

export async function toggleCrewVisibility(crewId: string, hidden: boolean) {
  return updateCrew(crewId, { hiddenInSchedule: hidden });
}

export async function deleteCrew(crewId: string) {
  const userId = await getUserId();
  if (!userId) throw new Error("請先登入");

  const { error } = await supabase
    .from("crews")
    .delete()
    .eq("id", crewId)
    .eq("user_id", userId);

  if (error) throw new Error(`刪除工班失敗: ${error.message}`);
  revalidatePath("/account/crews");
  revalidatePath("/schedule");
}

// Move trade to (crew, date). Used by drag-drop grid.
// Preserves the original trade duration: if it was a 3-day trade, the moved
// version stays 3 days. Without this the end_date stays put and ends up
// before start_date, which causes the trade to silently disappear from
// the schedule (date-in-range checks fail).
export async function moveTrade(
  tradeId: string,
  target: { crewId: string | null; startDate: string; projectId?: string }
) {
  const { data: current } = await supabase
    .from("trades")
    .select("start_date, end_date")
    .eq("id", tradeId)
    .single();

  let newEndDate: string | null = null;
  if (current?.start_date && current?.end_date) {
    // Compute duration in days (UTC math is fine for ISO date strings)
    const oldStartMs = Date.parse(`${current.start_date}T00:00:00Z`);
    const oldEndMs = Date.parse(`${current.end_date}T00:00:00Z`);
    const durationDays = Math.max(
      0,
      Math.round((oldEndMs - oldStartMs) / 86400000)
    );
    const newStartMs = Date.parse(`${target.startDate}T00:00:00Z`);
    const newEnd = new Date(newStartMs + durationDays * 86400000);
    newEndDate = `${newEnd.getUTCFullYear()}-${String(newEnd.getUTCMonth() + 1).padStart(2, "0")}-${String(newEnd.getUTCDate()).padStart(2, "0")}`;
  }

  const updateData: Record<string, unknown> = {
    crew_id: target.crewId,
    start_date: target.startDate,
    end_date: newEndDate,
  };

  const { error } = await supabase
    .from("trades")
    .update(updateData)
    .eq("id", tradeId);

  if (error) throw new Error(`Failed to move trade: ${error.message}`);
  revalidatePath("/schedule");
  if (target.projectId) revalidatePath(`/projects/${target.projectId}`);
}

// ===== Photos =====

export async function deletePhoto(photoId: string, projectId: string) {
  const userId = await getUserId();
  if (!userId) throw new Error("請先登入");

  // Fetch photo to get storage paths
  const { data: photo, error: fetchError } = await supabase
    .from("photos")
    .select("file_path, thumbnail_path, user_id")
    .eq("id", photoId)
    .single();

  if (fetchError || !photo) throw new Error("找不到照片");
  if (photo.user_id !== userId) throw new Error("無權限刪除此照片");

  // Delete from storage
  const paths = [photo.file_path, photo.thumbnail_path].filter(Boolean);
  if (paths.length > 0) {
    await supabaseAdmin.storage.from("photos").remove(paths);
  }

  // Delete DB row
  const { error } = await supabase
    .from("photos")
    .delete()
    .eq("id", photoId);

  if (error) throw new Error(`刪除照片失敗: ${error.message}`);
  revalidatePath(`/projects/${projectId}`);
}

// ===== Helpers =====

async function recalculateProjectTotal(projectId: string) {
  const { data: quotes } = await supabase
    .from("quotes")
    .select("id")
    .eq("project_id", projectId)
    .order("version", { ascending: false })
    .limit(1);

  if (!quotes?.length) return;

  const { data: sections } = await supabase
    .from("quote_sections")
    .select("id")
    .eq("quote_id", quotes[0].id);

  if (!sections?.length) return;

  const { data: items } = await supabase
    .from("quote_items")
    .select("quantity, unit_cost, markup_percent")
    .in("section_id", sections.map((s) => s.id));

  if (!items?.length) return;

  const total = items.reduce((sum, item) => {
    const clientPrice = Math.round(item.unit_cost * (1 + item.markup_percent / 100));
    return sum + clientPrice * item.quantity;
  }, 0);

  await supabase
    .from("projects")
    .update({ total_amount: total })
    .eq("id", projectId);
}

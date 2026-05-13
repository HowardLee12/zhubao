import { supabase } from "./supabase";
import { getUserId } from "./auth";
import {
  ProjectRow, TradeRow, PaymentRow,
  QuoteRow, QuoteSectionRow, QuoteItemRow,
  UserRow, PhotoRow, CrewRow,
} from "./database.types";

export const PLAN_LIMITS = {
  free: { quotes: 20, projects: Infinity, photosPerProject: 100 },
  pro: { quotes: Infinity, projects: Infinity, photosPerProject: Infinity },
} as const;

export interface ProjectWithRelations extends ProjectRow {
  trades: TradeRow[];
  payments: PaymentRow[];
}

export interface QuoteWithSections extends QuoteRow {
  sections: (QuoteSectionRow & { items: QuoteItemRow[] })[];
}

export interface QuoteWithProject extends QuoteRow {
  project: ProjectRow | null;
}

export async function getProjects(): Promise<ProjectWithRelations[]> {
  const userId = await getUserId();

  if (!userId) return [];

  const { data: projects, error } = await supabase
    .from("projects")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  if (error) throw new Error(`Failed to fetch projects: ${error.message}`);

  const rows = (projects ?? []) as ProjectRow[];
  const projectIds = rows.map((p) => p.id);

  if (projectIds.length === 0) return [];

  const [tradesResult, paymentsResult] = await Promise.all([
    supabase.from("trades").select("*").in("project_id", projectIds).order("sort_order"),
    supabase.from("payments").select("*").in("project_id", projectIds).order("sort_order"),
  ]);

  const trades = (tradesResult.data ?? []) as TradeRow[];
  const payments = (paymentsResult.data ?? []) as PaymentRow[];

  return rows.map((project) => ({
    ...project,
    trades: trades.filter((t) => t.project_id === project.id),
    payments: payments.filter((p) => p.project_id === project.id),
  }));
}

export async function getProject(id: string): Promise<ProjectWithRelations | null> {
  const userId = await getUserId();

  if (!userId) return null;

  const { data, error } = await supabase
    .from("projects")
    .select("*")
    .eq("id", id)
    .eq("user_id", userId)
    .single();

  if (error) return null;
  const project = data as ProjectRow;

  const [tradesResult, paymentsResult] = await Promise.all([
    supabase.from("trades").select("*").eq("project_id", id).order("sort_order"),
    supabase.from("payments").select("*").eq("project_id", id).order("sort_order"),
  ]);

  return {
    ...project,
    trades: (tradesResult.data ?? []) as TradeRow[],
    payments: (paymentsResult.data ?? []) as PaymentRow[],
  };
}

export async function getQuote(quoteId: string): Promise<QuoteWithSections | null> {
  const { data, error } = await supabase
    .from("quotes")
    .select("*")
    .eq("id", quoteId)
    .single();

  if (error) return null;
  const quote = data as QuoteRow;

  const { data: sectionsData } = await supabase
    .from("quote_sections")
    .select("*")
    .eq("quote_id", quoteId)
    .order("sort_order");

  const sections = (sectionsData ?? []) as QuoteSectionRow[];
  const sectionIds = sections.map((s) => s.id);

  if (sectionIds.length === 0) {
    return { ...quote, sections: [] };
  }

  const { data: itemsData } = await supabase
    .from("quote_items")
    .select("*")
    .in("section_id", sectionIds)
    .order("sort_order");

  const items = (itemsData ?? []) as QuoteItemRow[];

  return {
    ...quote,
    sections: sections.map((section) => ({
      ...section,
      items: items.filter((item) => item.section_id === section.id),
    })),
  };
}

export async function getLatestQuoteTotals(
  projectId: string
): Promise<{ cost: number; client: number; profit: number; margin: number } | null> {
  const { data: quotes } = await supabase
    .from("quotes")
    .select("id")
    .eq("project_id", projectId)
    .order("version", { ascending: false })
    .limit(1);

  if (!quotes?.length) return null;

  const quote = await getQuote((quotes[0] as { id: string }).id);
  if (!quote) return null;

  let cost = 0;
  let client = 0;
  for (const section of quote.sections) {
    for (const item of section.items) {
      const qty = Number(item.quantity);
      const unitCost = item.unit_cost;
      const markup = Number(item.markup_percent);
      cost += unitCost * qty;
      client += Math.round(unitCost * (1 + markup / 100)) * qty;
    }
  }
  const profit = client - cost;
  const margin = client > 0 ? (profit / client) * 100 : 0;
  return { cost, client, profit, margin };
}

export async function getQuotesByProject(projectId: string): Promise<QuoteRow[]> {
  const { data, error } = await supabase
    .from("quotes")
    .select("*")
    .eq("project_id", projectId)
    .order("version", { ascending: false });

  if (error) return [];
  return (data ?? []) as QuoteRow[];
}

export async function getAllQuotesWithProjects(): Promise<QuoteWithProject[]> {
  const userId = await getUserId();

  if (!userId) return [];

  const { data: userProjects } = await supabase
    .from("projects")
    .select("id")
    .eq("user_id", userId);
  const userProjectIds = ((userProjects ?? []) as { id: string }[]).map((p) => p.id);

  if (userProjectIds.length === 0) return [];

  const { data, error } = await supabase
    .from("quotes")
    .select("*")
    .in("project_id", userProjectIds)
    .order("updated_at", { ascending: false });

  if (error) throw new Error(`Failed to fetch quotes: ${error.message}`);

  const quotes = (data ?? []) as QuoteRow[];
  const projectIds = [...new Set(quotes.map((q) => q.project_id))];

  if (projectIds.length === 0) return [];

  const { data: projectsData } = await supabase
    .from("projects")
    .select("*")
    .in("id", projectIds);

  const projects = (projectsData ?? []) as ProjectRow[];
  const projectMap = new Map(projects.map((p) => [p.id, p]));

  return quotes.map((q) => ({
    ...q,
    project: projectMap.get(q.project_id) ?? null,
  }));
}

export async function getUserProfile(): Promise<UserRow | null> {
  const userId = await getUserId();
  if (!userId) return null;

  const { data, error } = await supabase
    .from("users")
    .select("*")
    .eq("id", userId)
    .single();

  if (error) return null;
  return data as UserRow;
}

export interface UserUsage {
  quoteCount: number;
  projectCount: number;
}

export async function getUserUsage(): Promise<UserUsage> {
  const userId = await getUserId();
  if (!userId) return { quoteCount: 0, projectCount: 0 };

  const { data: projects } = await supabase
    .from("projects")
    .select("id")
    .eq("user_id", userId);

  const projectIds = ((projects ?? []) as { id: string }[]).map((p) => p.id);

  if (projectIds.length === 0) return { quoteCount: 0, projectCount: projectIds.length };

  const { count } = await supabase
    .from("quotes")
    .select("id", { count: "exact", head: true })
    .in("project_id", projectIds);

  return {
    quoteCount: count ?? 0,
    projectCount: projectIds.length,
  };
}

export async function canCreateQuote(): Promise<boolean> {
  const [profile, usage] = await Promise.all([
    getUserProfile(),
    getUserUsage(),
  ]);

  if (!profile) return false;

  const limit = PLAN_LIMITS[profile.plan]?.quotes ?? PLAN_LIMITS.free.quotes;
  return usage.quoteCount < limit;
}

export async function canCreateProject(): Promise<boolean> {
  const [profile, usage] = await Promise.all([
    getUserProfile(),
    getUserUsage(),
  ]);

  if (!profile) return false;

  const limit = PLAN_LIMITS[profile.plan]?.projects ?? PLAN_LIMITS.free.projects;
  return usage.projectCount < limit;
}

// ===== Photos =====

export async function getPhotosByProject(projectId: string): Promise<PhotoRow[]> {
  const { data, error } = await supabase
    .from("photos")
    .select("*")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false });

  if (error) return [];
  return (data ?? []) as PhotoRow[];
}

export async function getPhotoCount(projectId: string): Promise<number> {
  const { count } = await supabase
    .from("photos")
    .select("id", { count: "exact", head: true })
    .eq("project_id", projectId);

  return count ?? 0;
}

export async function canUploadPhoto(projectId: string): Promise<{ allowed: boolean; remaining: number }> {
  const [profile, count] = await Promise.all([
    getUserProfile(),
    getPhotoCount(projectId),
  ]);

  const plan = profile?.plan ?? "free";
  const limit = PLAN_LIMITS[plan]?.photosPerProject ?? PLAN_LIMITS.free.photosPerProject;

  if (limit === Infinity) return { allowed: true, remaining: Infinity };

  return {
    allowed: count < limit,
    remaining: Math.max(0, limit - count),
  };
}

export function getPhotoPublicUrl(path: string): string {
  return supabase.storage.from("photos").getPublicUrl(path).data.publicUrl;
}

// ===== Crews =====

export async function getCrews(): Promise<CrewRow[]> {
  const userId = await getUserId();
  if (!userId) return [];

  const { data, error } = await supabase
    .from("crews")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: true });

  if (error) return [];
  return (data ?? []) as CrewRow[];
}

export async function getCrew(id: string): Promise<CrewRow | null> {
  const userId = await getUserId();
  if (!userId) return null;

  const { data, error } = await supabase
    .from("crews")
    .select("*")
    .eq("id", id)
    .eq("user_id", userId)
    .single();

  if (error) return null;
  return data as CrewRow;
}

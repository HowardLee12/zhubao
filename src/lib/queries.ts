import { supabase } from "./supabase";
import {
  ProjectRow, TradeRow, PaymentRow,
  QuoteRow, QuoteSectionRow, QuoteItemRow,
} from "./database.types";

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
  const { data: projects, error } = await supabase
    .from("projects")
    .select("*")
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
  const { data, error } = await supabase
    .from("projects")
    .select("*")
    .eq("id", id)
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
  const { data, error } = await supabase
    .from("quotes")
    .select("*")
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

export type UserPlan = "free" | "pro";

export type UserRow = {
  id: string;
  line_user_id: string;
  display_name: string;
  picture_url: string;
  plan: UserPlan;
  plan_expires_at: string | null;
  ecpay_trade_no: string | null;
  created_at: string;
  updated_at: string;
};

export type ProjectRow = {
  id: string;
  customer_name: string;
  address: string;
  user_id: string | null;
  description: string;
  total_amount: number;
  status: "planning" | "in_progress" | "completed";
  progress: number;
  created_at: string;
  updated_at: string;
};

export type TradeRow = {
  id: string;
  project_id: string;
  name: string;
  crew: string;
  crew_id: string | null;
  start_date: string | null;
  end_date: string | null;
  status: "done" | "active" | "pending";
  sort_order: number;
  created_at: string;
};

export type CrewRow = {
  id: string;
  user_id: string;
  name: string;
  role: string;
  phone: string;
  hidden_in_schedule: boolean;
  created_at: string;
  updated_at: string;
};

export type PaymentRow = {
  id: string;
  project_id: string;
  name: string;
  percentage: number;
  amount: number;
  due_date: string | null;
  status: "paid" | "due" | "upcoming" | "pending";
  paid_date: string | null;
  sort_order: number;
  created_at: string;
};

export type QuoteRow = {
  id: string;
  project_id: string;
  version: number;
  notes: string;
  created_at: string;
  updated_at: string;
};

export type QuoteSectionRow = {
  id: string;
  quote_id: string;
  name: string;
  icon: string;
  sort_order: number;
};

export type QuoteItemRow = {
  id: string;
  section_id: string;
  name: string;
  spec: string;
  unit: string;
  quantity: number;
  unit_cost: number;
  markup_percent: number;
  sort_order: number;
};

export type PhotoRow = {
  id: string;
  project_id: string;
  trade_id: string | null;
  user_id: string;
  file_path: string;
  thumbnail_path: string;
  caption: string;
  file_size: number;
  created_at: string;
};

export interface Database {
  public: {
    Tables: {
      projects: {
        Row: ProjectRow;
        Insert: Partial<ProjectRow> & Pick<ProjectRow, "customer_name" | "address">;
        Update: Partial<ProjectRow>;
      };
      trades: {
        Row: TradeRow;
        Insert: Partial<TradeRow> & Pick<TradeRow, "project_id" | "name">;
        Update: Partial<TradeRow>;
      };
      payments: {
        Row: PaymentRow;
        Insert: Partial<PaymentRow> & Pick<PaymentRow, "project_id" | "name">;
        Update: Partial<PaymentRow>;
      };
      quotes: {
        Row: QuoteRow;
        Insert: Partial<QuoteRow> & Pick<QuoteRow, "project_id">;
        Update: Partial<QuoteRow>;
      };
      quote_sections: {
        Row: QuoteSectionRow;
        Insert: Partial<QuoteSectionRow> & Pick<QuoteSectionRow, "quote_id" | "name">;
        Update: Partial<QuoteSectionRow>;
      };
      quote_items: {
        Row: QuoteItemRow;
        Insert: Partial<QuoteItemRow> & Pick<QuoteItemRow, "section_id" | "name">;
        Update: Partial<QuoteItemRow>;
      };
      crews: {
        Row: CrewRow;
        Insert: Partial<CrewRow> & Pick<CrewRow, "user_id" | "name">;
        Update: Partial<CrewRow>;
      };
    };
  };
}

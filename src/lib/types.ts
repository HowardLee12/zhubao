export interface Project {
  id: string;
  customerName: string;
  address: string;
  description: string;
  totalAmount: number;
  status: "planning" | "in_progress" | "completed";
  progress: number;
  trades: Trade[];
  payments: Payment[];
  createdAt: string;
}

export interface Trade {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  status: "done" | "active" | "pending";
  crew: string;
}

export interface QuoteItem {
  id: string;
  name: string;
  spec: string;
  unit: string;
  quantity: number;
  unitCost: number;
  markupPercent: number;
}

export interface QuoteSection {
  id: string;
  name: string;
  icon: string;
  items: QuoteItem[];
}

export interface Quote {
  id: string;
  projectId: string;
  customerName: string;
  address: string;
  version: number;
  sections: QuoteSection[];
  createdAt: string;
}

export interface Payment {
  id: string;
  name: string;
  percentage: number;
  amount: number;
  dueDate: string;
  status: "paid" | "due" | "upcoming" | "pending";
  paidDate?: string;
}

export type ViewMode = "cost" | "client";

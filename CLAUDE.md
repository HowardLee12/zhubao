# 裝潢工程管理系統 — Reno Demo

## Project Overview

Taiwan renovation industry SaaS tool — mobile-first web app for small (1-5 person) renovation studios. Core feature: **dual-version quoting** (cost version for designer, client version for homeowner) with automatic markup calculation. Will integrate with LINE (LIFF) as primary distribution channel.

- **Color theme**: Sage Green
- **Language**: Traditional Chinese (zh-TW)
- **Target**: Mobile-first (max-width 430px)

## Tech Stack

- **Framework**: Next.js 16.1.7 (App Router, TypeScript, Turbopack)
- **Styling**: Tailwind CSS v4 with custom Sage Green theme
- **Database**: Supabase (PostgreSQL) — free tier
- **Auth**: Pending (will use LINE LIFF auth → Supabase RLS)
- **Deployment**: Pending (planned: Vercel)

## Project Structure

```
src/
├── app/
│   ├── page.tsx              # Dashboard — stats cards + project list
│   ├── projects/
│   │   ├── new/page.tsx      # Create project form (client-side)
│   │   └── [id]/page.tsx     # Project detail — trades + payments
│   ├── quotes/
│   │   ├── page.tsx          # Quotes list — grouped by project
│   │   ├── new/page.tsx      # Quote builder (supports clone via ?cloneFrom=)
│   │   └── [id]/page.tsx     # Quote detail — cost/client toggle
│   ├── schedule/page.tsx     # Trade scheduling with conflict detection
│   ├── payments/page.tsx     # Payment tracking
│   └── api/quotes/[id]/      # Quote data API route
├── components/
│   ├── bottom-nav.tsx        # Bottom tab navigation
│   ├── project-card.tsx      # Project summary card
│   ├── project-header.tsx     # Project header with edit/delete buttons
│   ├── edit-project-form.tsx  # Inline edit project info form
│   ├── project-status-control.tsx # Status pills + progress slider
│   ├── project-quotes-section.tsx # Inline quote list + builder toggle
│   ├── inline-quote-builder.tsx   # Inline quote creation (no page navigation)
│   ├── trade-list.tsx        # Interactive trade list (status toggle + swipe delete)
│   ├── payment-list.tsx      # Interactive payment list (paid toggle + swipe delete)
│   ├── add-trade-form.tsx    # Add new trade form
│   ├── add-payment-form.tsx  # Add new payment form
│   ├── schedule-trade-card.tsx # Schedule page trade card (status toggle + project link)
│   ├── quote-section-card.tsx # Quote section display
│   └── quote-version-toggle.tsx # Cost/client version switch
├── lib/
│   ├── supabase.ts           # Supabase client (untyped, anon key)
│   ├── database.types.ts     # Explicit TypeScript types for DB rows
│   ├── queries.ts            # Data access layer (getProjects, getQuote, etc.)
│   ├── actions.ts            # Server actions (CRUD operations)
│   ├── format.ts             # Currency, date, price calculation utils
│   └── types.ts              # Frontend-facing types
└── supabase/
    └── schema.sql            # 6 tables with RLS (open policies for now)
```

## Database Tables

1. **projects** — customer info, status, progress, total amount
2. **trades** — trade scheduling (crew, dates, status)
3. **payments** — payment milestones and tracking
4. **quotes** — versioned quotes per project
5. **quote_sections** — categorized sections (拆除, 水電, 泥作, etc.)
6. **quote_items** — line items with unit cost + markup %

## Key Features (Implemented)

- [x] Project CRUD with dashboard stats
- [x] Dual-view quoting — cost + client prices shown side by side per item, no toggle needed
- [x] Bidirectional price calculation — edit markup% or client price, the other auto-calculates
- [x] Real-time profit margin calculation
- [x] Quote versioning — grouped by project in list view
- [x] Clone existing quote to create new version (pre-populated)
- [x] Trade scheduling with crew conflict detection
- [x] Payment tracking with status indicators
- [x] 13 common renovation section templates
- [x] **Inline quote builder** — create/clone quotes without leaving project detail page
- [x] **Trade status toggle** — tap to cycle: 待排 → 進行中 → 完成 (on project detail + schedule page)
- [x] **Trade status dropdown** — select 待排/進行中/完成 (on project detail + schedule page)
- [x] **Payment status dropdown** — select 待收/即將到期/已到期/已收款 (on project detail + payments page)
- [x] **Swipe to delete** — trades and payments with confirmation dialog
- [x] **NumberInput component** — allows clearing field to retype (no stuck-on-zero issue)
- [x] **No emoji** — all icons use SVG or text labels
- [x] **Interactive schedule page** — toggle status, link to project detail, show unscheduled trades
- [x] **Interactive payments page** — mark paid, link to project detail
- [x] **New project redirect** — auto-navigate to project detail after creation
- [x] **Project info editing** — edit customer name, address, description inline
- [x] **Delete project** — with confirmation dialog, cascading delete
- [x] **Quotes list empty state** — links to project list page

## Pending Work
- [ ] **LINE LIFF SDK integration** — embed app in LINE, auth via LINE login
- [ ] **Supabase auth + RLS** — user-scoped data after LINE auth
- [ ] **Input validation** — zod schemas for server actions
- [ ] **Transactional writes** — atomic quote creation via Postgres function
- [ ] **Vercel deployment** — production deploy with env vars
- [ ] **Share quote via LINE** — generate client-version link

## Known Technical Decisions

- **Untyped Supabase client**: Supabase v2.99.2 generic type inference causes `never` types. Using explicit casts (`as ProjectRow`) instead.
- **Separate queries instead of joins**: Avoids Supabase type inference issues with relational queries.
- **RLS open policies**: Temporary — will tighten when LINE LIFF auth is added.
- **No transaction on quote creation**: Sequential inserts across 3 tables. Needs Postgres function for atomicity.

## Development

```bash
npm run dev    # Start dev server (localhost:3000)
npm run build  # Production build
```

Environment variables needed in `.env.local`:
```
NEXT_PUBLIC_SUPABASE_URL=<supabase-url>
NEXT_PUBLIC_SUPABASE_ANON_KEY=<supabase-anon-key>
```

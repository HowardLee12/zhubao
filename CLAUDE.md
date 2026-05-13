# Renoly — Reno Demo

## Project Overview

Taiwan renovation industry SaaS tool — mobile-first web app for small (1-5 person) renovation studios. Core feature: **dual-version quoting** (cost version for designer, client version for homeowner) with automatic markup calculation. Integrates with LINE (LIFF) as primary distribution channel.

- **Brand**: Renoly (renamed from 築報, 2026-05-13)
- **Color theme**: Warm orange/brick (`--orange #E2691F`, `--brick #A04428`, ink-warm scale). Legacy `sage-*` Tailwind tokens are remapped to warm equivalents in `globals.css` to avoid churning every file.
- **Typography**: Noto Sans TC (body) + SF Mono (numbers)
- **Language**: Traditional Chinese (zh-TW)
- **Target**: Mobile-first (max-width 430px)

## Tech Stack

- **Framework**: Next.js 16.1.7 (App Router, TypeScript, Turbopack)
- **Styling**: Tailwind CSS v4 with Renoly warm theme
- **Database**: Supabase (PostgreSQL) — free tier
- **Auth**: LINE LIFF SDK → Supabase (login via LINE in external browser + in-app browser)
- **Deployment**: Vercel

## Project Structure

```
src/
├── app/
│   ├── layout.tsx            # Root layout (no auth, just html/body)
│   ├── (auth)/               # Route group — requires LINE LIFF login
│   │   ├── layout.tsx        # LiffProvider + AuthGuard + BottomNav
│   │   ├── page.tsx          # Dashboard — stats cards + project list
│   │   ├── loading.tsx       # Dashboard skeleton screen
│   │   ├── projects/
│   │   │   ├── new/page.tsx  # Create project form (client-side)
│   │   │   └── [id]/page.tsx # Project detail — trades + payments
│   │   ├── quotes/
│   │   │   ├── page.tsx      # Quotes list — grouped by project
│   │   │   ├── loading.tsx   # Quotes skeleton screen
│   │   │   ├── new/page.tsx  # Quote builder (supports clone via ?cloneFrom=)
│   │   │   └── [id]/page.tsx # Quote detail — cost/client toggle + share
│   │   ├── schedule/
│   │   │   ├── page.tsx      # Trade scheduling with conflict detection
│   │   │   └── loading.tsx   # Schedule skeleton screen
│   │   ├── payments/
│   │   │   ├── page.tsx      # Payment tracking (TopBar + stats + overdue banner)
│   │   │   └── loading.tsx   # Payments skeleton screen
│   │   └── account/
│   │       ├── page.tsx      # Account — profile + plan + usage + menu list
│   │       └── crews/page.tsx # 工班通訊錄 CRUD (name/role/phone)
│   ├── (public)/             # Route group — no auth required
│   │   ├── layout.tsx        # Passthrough layout
│   │   └── quotes/[id]/share/page.tsx  # Public quote share page for homeowners
│   ├── (auth)/quotes/[id]/line-preview/page.tsx  # LINE chat mock for the designer to preview owner view
│   └── api/
│       ├── quotes/[id]/      # Quote data API route (auth + ownership check)
│       └── photos/upload/    # Photo upload API (compress → storage → DB)
├── components/
│   ├── ui/                   # Renoly layout primitives
│   │   ├── top-bar.tsx       # Sticky title + subtitle + back/right slots + IconButton
│   │   ├── hero-card.tsx     # Orange→brick gradient hero with N-col stats + progress
│   │   ├── stat-card.tsx     # Stat tile (default/accent/dark variants)
│   │   ├── pill.tsx          # Badge with neutral/orange/brick/green/amber/red/dark variants
│   │   └── section-header.tsx # Section title + optional action link
│   ├── bottom-nav.tsx        # Bottom tab navigation (auto-hidden on /line-preview)
│   ├── liff-provider.tsx     # LINE LIFF SDK init + login trigger
│   ├── auth-guard.tsx        # Auth gate — shows login prompt or children
│   ├── project-card.tsx      # Project summary card (orange progress + warm tones)
│   ├── project-header.tsx    # TopBar + HeroCard + edit/delete actions
│   ├── edit-project-form.tsx # Inline edit project info form
│   ├── project-status-control.tsx # Segmented status pills + progress slider
│   ├── project-quotes-section.tsx # Inline quote list + builder toggle
│   ├── inline-quote-builder.tsx   # Inline quote creation (no page navigation)
│   ├── trade-list.tsx        # Interactive trade list (status dropdown + swipe delete/notify)
│   ├── payment-list.tsx      # Vertical timeline (paid/due/upcoming/pending dots)
│   ├── payments-page-list.tsx # Global payments grouped by status + month
│   ├── add-trade-form.tsx    # Add trade with crew picker (existing crews + inline new)
│   ├── add-payment-form.tsx  # Add new payment form
│   ├── schedule-view.tsx     # Wraps list / grid view + conflict resolution sheet
│   ├── schedule-grid.tsx     # Drag-drop crew × week-day grid
│   ├── schedule-trade-card.tsx # Schedule page trade card (status toggle + project link)
│   ├── schedule-conflict-sheet.tsx # Bottom sheet: reschedule / reassign / LINE notify
│   ├── crew-manager.tsx      # CRUD UI for crews directory
│   ├── today-trade-strip.tsx # Dashboard horizontal strip of today's trades
│   ├── quote-section-card.tsx # Quote section display
│   ├── quote-version-toggle.tsx # Cost/client version switch
│   ├── logout-button.tsx     # Logout button (clears cookies + LIFF logout)
│   ├── photo-grid.tsx        # Photo thumbnail grid with trade filter tabs
│   ├── photo-lightbox.tsx    # Full-size photo viewer overlay with delete
│   └── photo-upload.tsx      # Photo upload with compression + progress
├── lib/
│   ├── supabase.ts           # Supabase client (untyped, anon key)
│   ├── liff.ts               # LINE LIFF SDK wrapper (init, login, share, isInitialized)
│   ├── database.types.ts     # Explicit TypeScript types for DB rows
│   ├── queries.ts            # Data access layer (getProjects, getQuote, getCrews, etc.)
│   ├── actions.ts            # Server actions (CRUD ops + crew mgmt + moveTrade)
│   ├── format.ts             # Currency, date, greeting, schedule-date helpers
│   ├── week.ts               # Week-day helpers for the schedule grid
│   ├── image-compress.ts     # Client-side WebP/JPEG compression (photo + thumbnail)
│   └── types.ts              # Frontend-facing types
└── supabase/
    ├── schema.sql                  # Base schema (open RLS for now)
    ├── migration-add-users.sql     # LINE LIFF user table
    ├── migration-add-user-plan.sql # free / pro plan column
    ├── migration-add-photos.sql    # Photos with thumbnails
    └── migration-add-crews.sql     # crews table + trades.crew_id + backfill from trades.crew text
```

## Database Tables

1. **users** — LINE user profile, plan (`free`/`pro`)
2. **projects** — customer info, status, progress, total amount
3. **trades** — trade scheduling (`crew` legacy text + `crew_id` FK to crews, dates, status)
4. **payments** — payment milestones and tracking
5. **quotes** — versioned quotes per project
6. **quote_sections** — categorized sections (拆除, 水電, 泥作, etc.)
7. **quote_items** — line items with unit cost + markup %
8. **photos** — construction photos (project_id, trade_id nullable, file_path, thumbnail_path, file_size)
9. **crews** — per-user crew directory (name/role/phone). Backfilled from existing `trades.crew` text on migration.

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
- [x] **LINE LIFF SDK integration** — login via LINE in both in-app and external browser
- [x] **Route groups** — `(auth)` for authenticated pages, `(public)` for unauthenticated (e.g. share page)
- [x] **Share quote to homeowner** — Web Share API (native iPhone share sheet) with LINE LIFF `shareTargetPicker` fallback
- [x] **Public quote share page** — `/quotes/[id]/share` pre-computes client prices, cost data never enters render tree
- [x] **Share trade schedule to contractor** — swipe to reveal "通知" button, native share with project/date/crew info
- [x] **Loading skeletons** — skeleton screens on dashboard, quotes, schedule, payments pages
- [x] **Optimistic updates** — trade status + schedule status update UI immediately, rollback on error
- [x] **Nav prefetch** — bottom nav links use `prefetch={true}` for faster tab switching
- [x] **API security** — `/api/quotes/[id]` has auth + ownership check, UUID validation
- [x] **Vercel deployment** — production deploy with env vars
- [x] **Account page** — profile display, plan info, usage stats, logout
- [x] **Free plan quota** — free: 20 quotes, unlimited projects, 100 photos/project (data-gravity strategy), enforced in server action + UI
- [x] **Bottom nav restructured** — 案件, 排程, 收款, 帳號 (removed 報價單 tab)
- [x] **施工照片管理** — upload, compress (WebP/JPEG), tag to trade, thumbnail grid, lightbox viewer, delete
- [x] **Photo compression** — client-side canvas resize: main ~300KB (1200px), thumbnail ~30KB (300px)
- [x] **Photo storage** — Supabase Storage bucket `photos`, path: `{userId}/{projectId}/{uuid}.ext`
- [x] **Photo quota** — free: 100/project, pro: unlimited

## Pending Work
- [ ] **Apply [migration-add-crews.sql](supabase/migration-add-crews.sql)** — Supabase MCP is read-only so it must be run via dashboard SQL editor before features that read crew_id (工班通訊錄 / drag-drop grid / conflict sheet) will populate with real data
- [ ] **Drop `trades.crew` text column** — once crew_id usage is fully verified
- [ ] **Supabase RLS tightening** — currently open policies (`USING (true)`), need user-scoped RLS
- [ ] **Child resource ownership checks** — trades, payments, quote items mutations need ownership verification via parent project
- [ ] **Input validation** — zod schemas for server actions
- [ ] **Transactional writes** — atomic quote creation via Postgres function
- [ ] **Photo sharing** — include photos in public share page for homeowners

## Renoly Refactor (2026-05-13)

Visual + feature refactor mapping the prototype (sage green → warm orange/brick, 築報 → Renoly):

- **P1**: Theme + brand swap; Noto Sans TC + SF Mono; sage-* tokens remapped to warm equivalents in [globals.css](src/app/globals.css)
- **P2**: Layout primitives (TopBar / HeroCard / StatCard / Pill / SectionHeader); BottomNav glass blur
- **P3**: Every page restyled — dashboard greeting + today strip, project hero gradient, quote total card with profit bar + hideCost toggle, schedule list with TODAY badge, payment timeline with dot rail, account menu list with hours-saved card
- **P4**: New features
  - `crews` table + `/account/crews` CRUD
  - `add-trade-form` uses crew picker chips (existing + inline-create)
  - `/schedule` toggles **list ↔ grid**; grid is a drag-drop crew × 6-day matrix using PointerEvents
  - Cross-project conflict detection bubble up to a bottom sheet with reschedule / reassign / LINE-notify actions
  - `/quotes/[id]/line-preview` renders a LINE chat mock so the designer can preview the homeowner view before sharing

## Known Technical Decisions

- **Untyped Supabase client**: Supabase v2.99.2 generic type inference causes `never` types. Using explicit casts (`as ProjectRow`) instead.
- **Separate queries instead of joins**: Avoids Supabase type inference issues with relational queries.
- **RLS open policies**: Temporary — will tighten when LINE LIFF auth is added.
- **No transaction on quote creation**: Sequential inserts across 3 tables. Needs Postgres function for atomicity.
- **LIFF login in external browser**: `isInLiff()` returns false in external browser. Use `isInitialized() && !isLoggedIn()` to trigger login universally.
- **Route groups for auth**: `(auth)/` wraps pages with LiffProvider + AuthGuard; `(public)/` has no auth. Root layout is bare.
- **Public share page security**: `toClientView()` pre-computes client prices so `unit_cost`/`markup_percent` never enter the React render tree.
- **Plan-based quotas**: `PLAN_LIMITS` in `queries.ts` defines per-plan limits. `canCreateQuote()` checks count vs limit. Server action enforces; UI hides create buttons.

## Development

```bash
npm run dev    # Start dev server (localhost:3000)
npm run build  # Production build
```

Environment variables needed in `.env.local`:
```
NEXT_PUBLIC_SUPABASE_URL=<supabase-url>
NEXT_PUBLIC_SUPABASE_ANON_KEY=<supabase-anon-key>
NEXT_PUBLIC_LIFF_ID=<line-liff-id>
```

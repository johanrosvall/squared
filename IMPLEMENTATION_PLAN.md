# Squared — Implementation Plan

## User Context
- **Background**: Non-technical / designer
- **Source**: Mowgli export with full spec + screen mockups
- **Project type**: Standalone new project
- **Approach**: Core flow first (Import → Transactions → Reconcile), then expand

## Tech Stack
| Layer | Choice | Why |
|-------|--------|-----|
| Framework | **Next.js 14 (App Router)** | Full-stack React, file-based routing, API routes |
| Database + Auth | **Supabase** | Postgres DB, built-in auth, row-level security |
| Styling | **Tailwind CSS** | Matches mockups (already in Tailwind), fast iteration |
| Fonts | **Albert Sans + DM Mono** | From mockup designs (Google Fonts) |
| Icons | **Lucide React** | Used in mockups |
| CSV Parsing | **Papa Parse** | Battle-tested CSV parser |
| Charts | **Recharts** | For analytics (Phase 3) |
| Deployment | **Vercel** | Zero-config Next.js hosting |

## Design System (from mockups)
- **Colors**: `#0A0A0A` (black), `#525252` (gray), `#E5003E` (red/expense), `#0066FF` (blue/accent), `#8B5CF6` (purple/partner), `#FFFFFF` (white), `#F5F5F5` (light gray)
- **Typography**: Albert Sans (UI), DM Mono (numbers/amounts)
- **Borders**: 2px solid black, sharp corners (no border-radius)
- **Buttons**: Uppercase, tracking-widest, black fill or black border
- **Cards**: 2px black border, hover shadow

## File Structure
```
squared/
├── app/
│   ├── layout.tsx              # Root layout (fonts, providers)
│   ├── page.tsx                # Redirect to /dashboard or /auth
│   ├── auth/
│   │   └── page.tsx            # Login/Signup
│   ├── dashboard/
│   │   └── page.tsx            # Dashboard
│   ├── accounts/
│   │   └── page.tsx            # Account management
│   ├── import/
│   │   └── page.tsx            # CSV import wizard
│   ├── transactions/
│   │   └── page.tsx            # Transaction list (unified + per-account)
│   ├── reconcile/
│   │   └── page.tsx            # Reconciliation matching
│   ├── settle/
│   │   └── page.tsx            # Settled Up / Net Balance
│   ├── analytics/
│   │   └── page.tsx            # Analytics & Reporting
│   └── settings/
│       └── page.tsx            # Settings hub
├── components/
│   ├── layout/
│   │   ├── GlobalNav.tsx       # Persistent header nav
│   │   └── PageShell.tsx       # Content wrapper
│   ├── ui/                     # Shared design system components
│   │   ├── Button.tsx
│   │   ├── Input.tsx
│   │   ├── Select.tsx
│   │   ├── Card.tsx
│   │   ├── Badge.tsx
│   │   ├── Modal.tsx
│   │   └── Table.tsx
│   ├── accounts/               # Account-specific components
│   ├── import/                 # CSV import wizard steps
│   ├── transactions/           # Transaction list components
│   └── reconcile/              # Reconciliation components
├── lib/
│   ├── supabase/
│   │   ├── client.ts           # Browser Supabase client
│   │   ├── server.ts           # Server Supabase client
│   │   └── middleware.ts       # Auth middleware
│   ├── types.ts                # TypeScript types (from data model)
│   └── utils.ts                # Shared utilities
├── supabase/
│   └── migrations/             # SQL migration files
│       └── 001_initial_schema.sql
└── public/
```

---

## Implementation Tasks

### Phase 0: Project Setup & Infrastructure
- [x] **0.1** Initialize Next.js project with TypeScript, Tailwind CSS, ESLint
- [x] **0.2** Configure Tailwind with custom design tokens (colors, fonts)
- [x] **0.3** Install dependencies (lucide-react, papaparse, @supabase/ssr, etc.)
- [x] **0.4** Set up Supabase project configuration (client, server, middleware)
- [x] **0.5** Create database schema migration (all tables from data model)
- [x] **0.6** Set up Row Level Security policies on all tables
- [x] **0.7** Build shared UI components (Button, Input, Select, Card, Badge, Modal, Table)
- [x] **0.8** Build GlobalNav layout component (from mockup header)
- [x] **0.9** Build PageShell layout with root layout (fonts, Supabase provider)
- [x] **0.10** Write setup guide for Supabase + Vercel (for the user)

### Phase 1: Auth & Account Setup (Journey 1)
- [x] **1.1** Build AuthenticationScreen (login + signup states) with Supabase Auth
- [x] **1.2** Add auth middleware (redirect unauthenticated users)
- [x] **1.3** Build AccountsManagement page — gallery view (default state)
- [x] **1.4** Build AccountsManagement — create account form + Supabase insert
- [x] **1.5** Build AccountsManagement — import history view (per account)
- [x] **1.6** Build AccountsManagement — balance reconciliation tool

### Phase 2: CSV Import Flow (Journey 1.2)
- [x] **2.1** Build CSV Import wizard — Step 1: File upload + account selector + raw preview
- [x] **2.2** Build CSV Import wizard — Step 2: Column mapping interface with validation
- [x] **2.3** Build CSV Import wizard — Step 3: Duplicate detection + review UI
- [x] **2.4** Build CSV Import wizard — Step 4: Import summary + write to Supabase
- [x] **2.5** Create ImportBatch records and link transactions

### Phase 3: Transaction List (Journey 2)
- [x] **3.1** Build TransactionList page — Per-Account view with account grouping
- [x] **3.2** Build TransactionList page — Unified view (exploded CC, 50% shared, badges)
- [x] **3.3** Build view mode toggle (Unified vs Per-Account)
- [x] **3.4** Build filter bar (date range, account, category, shared status, reimbursement, partner transfers)
- [x] **3.5** Build transaction detail panel (expand on click) with inline editing
- [x] **3.6** Build CC Bill Reconciliation modal (designate payment → link CC transactions)
- [x] **3.7** Build CreditCardBillView screen (transfer view + exploded view)
- [x] **3.8** Implement partner transfer identification logic (match counterparty to contacts)
- [x] **3.9** Build partner transfer visual indicators (purple badges, highlights)

### Phase 4: Reconciliation & Settlement (Journey 3)
- [x] **4.1** Build ReconciliationMatchingInterface — three-column layout shell
- [x] **4.2** Build Left panel: unreimbursed shared expenses list with multi-select
- [x] **4.3** Build Right panel: unallocated transfers list (partner transfers grouped at top)
- [x] **4.4** Build Center panel: settlement composer with allocation inputs
- [x] **4.5** Implement settlement creation logic (SettlementGroup + ReimbursementAllocation writes)
- [x] **4.6** Build post-settlement confirmation state
- [x] **4.7** Build SettledUpNetBalanceView — summary cards + net calculation
- [x] **4.8** Build SettledUpNetBalanceView — drill-down into unsettled expenses
- [x] **4.9** Build SettledUpNetBalanceView — settlement history list

### Phase 5: Dashboard (Journey 1.5)
- [x] **5.1** Build Dashboard — spending section (category breakdown cards + table)
- [x] **5.2** Build Dashboard — incomes section (source breakdown + table)
- [x] **5.3** Build Dashboard — transaction list summary section
- [x] **5.4** Build Dashboard — CTA prompts (stale data, settle up, review duplicates)

### Phase 6: Analytics & Settings (Journey 4)
- [ ] **6.1** Build Analytics page — time period selector + spending by category chart
- [ ] **6.2** Build Analytics page — CC vs Debit comparison, shared vs personal split
- [ ] **6.3** Build Analytics page — data tables with drill-down to transactions
- [x] **6.4** Build Settings page — profile settings section
- [x] **6.5** Build Settings page — contacts management (partner with purple indicators)
- [x] **6.6** Build Settings page — reimbursement rules management
- [x] **6.7** Build Settings page — category management (hierarchical, colors)
- [x] **6.8** Build Settings page — import settings + data export

### Phase 7: Polish & Deploy
- [ ] **7.1** Add loading states, error boundaries, toast notifications
- [ ] **7.2** Add responsive tweaks (this is desktop-first but ensure nothing breaks)
- [ ] **7.3** Write Vercel deployment guide for the user
- [ ] **7.4** Final QA pass across all screens

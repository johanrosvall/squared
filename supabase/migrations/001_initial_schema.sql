-- Squared: Initial Database Schema
-- Run this in Supabase SQL Editor (Dashboard > SQL Editor > New Query)

-- ─── Users Profile Table ─────────────────────────────────
-- Extends Supabase auth.users with app-specific fields
create table public.profiles (
  id uuid references auth.users on delete cascade primary key,
  email text not null,
  name text not null default '',
  default_currency text not null default 'USD',
  date_format text not null default 'MM/DD/YYYY',
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;
create policy "Users can view own profile" on public.profiles for select using (auth.uid() = id);
create policy "Users can update own profile" on public.profiles for update using (auth.uid() = id);
create policy "Users can insert own profile" on public.profiles for insert with check (auth.uid() = id);

-- Auto-create profile on signup
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, email, name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'name', ''));
  return new;
end;
$$ language plpgsql security definer;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ─── Contacts ────────────────────────────────────────────
create table public.contacts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete cascade not null,
  name text not null,
  is_primary_partner boolean not null default false,
  swish_number text,
  venmo_handle text,
  zelle_email text,
  other_payment_app_identifier text,
  notes text,
  created_at timestamptz not null default now()
);

alter table public.contacts enable row level security;
create policy "Users can manage own contacts" on public.contacts for all using (auth.uid() = user_id);

-- ─── Accounts ────────────────────────────────────────────
create type account_type as enum ('checking', 'savings', 'credit_card', 'shared', 'other');

create table public.accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete cascade not null,
  name text not null,
  type account_type not null default 'checking',
  institution text,
  currency text not null default 'USD',
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.accounts enable row level security;
create policy "Users can manage own accounts" on public.accounts for all using (auth.uid() = user_id);

-- ─── Categories ──────────────────────────────────────────
create table public.categories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete cascade not null,
  name text not null,
  parent_id uuid references public.categories(id) on delete set null,
  color text,
  is_shared boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.categories enable row level security;
create policy "Users can manage own categories" on public.categories for all using (auth.uid() = user_id);

-- ─── Reimbursement Rules ─────────────────────────────────
create table public.reimbursement_rules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete cascade not null,
  name text not null,
  is_active boolean not null default true,
  match_criteria jsonb not null default '{}',
  action jsonb not null default '{}',
  created_at timestamptz not null default now(),
  last_matched_at timestamptz
);

alter table public.reimbursement_rules enable row level security;
create policy "Users can manage own rules" on public.reimbursement_rules for all using (auth.uid() = user_id);

-- ─── Import Batches ──────────────────────────────────────
create table public.import_batches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete cascade not null,
  account_id uuid references public.accounts(id) on delete cascade not null,
  file_name text not null,
  import_date timestamptz not null default now(),
  file_hash text,
  raw_row_count integer not null default 0,
  imported_count integer not null default 0,
  skipped_count integer not null default 0
);

alter table public.import_batches enable row level security;
create policy "Users can manage own batches" on public.import_batches for all using (auth.uid() = user_id);

-- ─── Transactions ────────────────────────────────────────
create type reimbursement_status as enum ('none', 'pending', 'partial', 'full');
create type transaction_type as enum ('expense', 'income', 'transfer', 'cc_payment', 'partner_transfer');

create table public.transactions (
  id uuid primary key default gen_random_uuid(),
  account_id uuid references public.accounts(id) on delete cascade not null,
  import_batch_id uuid references public.import_batches(id) on delete set null,
  date date not null,
  posted_date date,
  amount numeric(12, 2) not null,
  currency text not null default 'USD',
  description text not null default '',
  raw_description text not null default '',
  category_id uuid references public.categories(id) on delete set null,
  is_shared boolean not null default false,
  reimbursement_status reimbursement_status not null default 'none',
  transaction_type transaction_type not null default 'expense',
  counterparty_account_id uuid references public.accounts(id) on delete set null,
  counterparty_contact_id uuid references public.contacts(id) on delete set null,
  matched_reimbursement_rule_id uuid references public.reimbursement_rules(id) on delete set null,
  notes text,
  is_duplicate boolean not null default false,
  parent_transaction_id uuid references public.transactions(id) on delete set null,
  is_partner_transfer boolean not null default false,
  created_at timestamptz not null default now()
);

-- Performance indexes
create index idx_transactions_account on public.transactions(account_id);
create index idx_transactions_date on public.transactions(date);
create index idx_transactions_category on public.transactions(category_id);
create index idx_transactions_type on public.transactions(transaction_type);
create index idx_transactions_shared on public.transactions(is_shared) where is_shared = true;
create index idx_transactions_reimbursement on public.transactions(reimbursement_status) where reimbursement_status != 'none';

-- RLS: Transactions belong to accounts which belong to users
alter table public.transactions enable row level security;
create policy "Users can manage own transactions" on public.transactions
  for all using (
    account_id in (select id from public.accounts where user_id = auth.uid())
  );

-- ─── Credit Card Bills ───────────────────────────────────
create table public.credit_card_bills (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete cascade not null,
  payment_transaction_id uuid references public.transactions(id) on delete cascade not null,
  credit_card_account_id uuid references public.accounts(id) on delete cascade not null,
  statement_start_date date not null,
  statement_end_date date not null,
  total_amount numeric(12, 2) not null,
  is_exploded boolean not null default false
);

alter table public.credit_card_bills enable row level security;
create policy "Users can manage own bills" on public.credit_card_bills for all using (auth.uid() = user_id);

-- ─── Settlement Groups ───────────────────────────────────
create type settlement_direction as enum ('to_shared', 'from_shared');

create table public.settlement_groups (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete cascade not null,
  transfer_transaction_id uuid references public.transactions(id) on delete cascade not null,
  total_amount numeric(12, 2) not null,
  direction settlement_direction not null,
  settlement_date date not null,
  note text,
  created_at timestamptz not null default now()
);

alter table public.settlement_groups enable row level security;
create policy "Users can manage own settlements" on public.settlement_groups for all using (auth.uid() = user_id);

-- ─── Reimbursement Allocations ───────────────────────────
create table public.reimbursement_allocations (
  id uuid primary key default gen_random_uuid(),
  settlement_group_id uuid references public.settlement_groups(id) on delete cascade not null,
  expense_transaction_id uuid references public.transactions(id) on delete cascade not null,
  allocated_amount numeric(12, 2) not null,
  created_at timestamptz not null default now()
);

alter table public.reimbursement_allocations enable row level security;
create policy "Users can manage own allocations" on public.reimbursement_allocations
  for all using (
    settlement_group_id in (select id from public.settlement_groups where user_id = auth.uid())
  );

-- ─── Seed Default Categories ─────────────────────────────
-- These will be created per-user via a function called after signup
create or replace function public.seed_default_categories(p_user_id uuid)
returns void as $$
begin
  insert into public.categories (user_id, name, color) values
    (p_user_id, 'Groceries', '#16A34A'),
    (p_user_id, 'Dining', '#F59E0B'),
    (p_user_id, 'Transport', '#3B82F6'),
    (p_user_id, 'Utilities', '#6B7280'),
    (p_user_id, 'Entertainment', '#EC4899'),
    (p_user_id, 'Travel', '#8B5CF6'),
    (p_user_id, 'Shopping', '#EF4444'),
    (p_user_id, 'Health', '#14B8A6'),
    (p_user_id, 'Housing', '#78716C'),
    (p_user_id, 'Insurance', '#64748B'),
    (p_user_id, 'Subscriptions', '#A855F7'),
    (p_user_id, 'Income', '#22C55E'),
    (p_user_id, 'Transfer', '#94A3B8'),
    (p_user_id, 'Other', '#D4D4D4');
end;
$$ language plpgsql security definer;

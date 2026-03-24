-- Add import_batch_id to credit_card_bills for batch-based period matching
alter table public.credit_card_bills
  add column if not exists import_batch_id uuid references public.import_batches(id) on delete set null;

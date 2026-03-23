-- Allow credit_card_bills to exist without a confirmed payment transaction
-- (so we can persist auto-detected periods before the user confirms the match)
ALTER TABLE public.credit_card_bills
  ALTER COLUMN payment_transaction_id DROP NOT NULL;

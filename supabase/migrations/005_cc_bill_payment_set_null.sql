-- Change credit_card_bills.payment_transaction_id from ON DELETE CASCADE to ON DELETE SET NULL
-- Previously, deleting the linked payment transaction would silently delete the entire bill record.
-- Now it just nullifies the link, preserving the bill record and its total_amount history.

ALTER TABLE public.credit_card_bills
  DROP CONSTRAINT IF EXISTS credit_card_bills_payment_transaction_id_fkey;

ALTER TABLE public.credit_card_bills
  ADD CONSTRAINT credit_card_bills_payment_transaction_id_fkey
  FOREIGN KEY (payment_transaction_id)
  REFERENCES public.transactions(id)
  ON DELETE SET NULL;

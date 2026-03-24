-- Add internal_transfer to the transaction_type enum
alter type public.transaction_type add value if not exists 'internal_transfer';

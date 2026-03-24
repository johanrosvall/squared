// ─── Enums ───────────────────────────────────────────────

export type AccountType =
  | "checking"
  | "savings"
  | "credit_card"
  | "shared"
  | "other";

export type ReimbursementStatus = "none" | "pending" | "partial" | "full";

export type TransactionType =
  | "expense"
  | "income"
  | "transfer"
  | "cc_payment"
  | "partner_transfer";

export type SettlementDirection = "to_shared" | "from_shared";

// ─── Core Models ─────────────────────────────────────────

export interface User {
  id: string;
  email: string;
  name: string;
  default_currency: string;
  date_format: string;
  created_at: string;
}

export interface Contact {
  id: string;
  user_id: string;
  name: string;
  is_primary_partner: boolean;
  swish_number: string | null;
  venmo_handle: string | null;
  zelle_email: string | null;
  other_payment_app_identifier: string | null;
  notes: string | null;
  created_at: string;
}

export interface Account {
  id: string;
  user_id: string;
  name: string;
  type: AccountType;
  institution: string | null;
  currency: string;
  is_active: boolean;
  created_at: string;
}

export interface Category {
  id: string;
  user_id: string;
  name: string;
  parent_id: string | null;
  color: string | null;
  is_shared: boolean;
  created_at: string;
}

export interface ImportBatch {
  id: string;
  user_id: string;
  account_id: string;
  file_name: string;
  import_date: string;
  file_hash: string;
  raw_row_count: number;
  imported_count: number;
  skipped_count: number;
}

export interface Transaction {
  id: string;
  account_id: string;
  import_batch_id: string | null;
  date: string;
  posted_date: string | null;
  amount: number;
  currency: string;
  description: string;
  raw_description: string;
  category_id: string | null;
  is_shared: boolean;
  reimbursement_status: ReimbursementStatus;
  transaction_type: TransactionType;
  counterparty_account_id: string | null;
  counterparty_contact_id: string | null;
  matched_reimbursement_rule_id: string | null;
  notes: string | null;
  is_duplicate: boolean;
  parent_transaction_id: string | null;
  is_partner_transfer: boolean;
  // Joined fields (optional, from queries)
  account?: Account;
  category?: Category;
  contact?: Contact;
}

export interface CreditCardBill {
  id: string;
  user_id: string;
  payment_transaction_id: string | null;
  credit_card_account_id: string;
  statement_start_date: string;
  statement_end_date: string;
  total_amount: number;
  is_exploded: boolean;
  import_batch_id: string | null;
  // Joined
  payment_transaction?: Transaction;
  charges?: Transaction[];
}

export interface SettlementGroup {
  id: string;
  user_id: string;
  transfer_transaction_id: string;
  total_amount: number;
  direction: SettlementDirection;
  settlement_date: string;
  note: string | null;
  created_at: string;
  // Joined
  transfer_transaction?: Transaction;
  allocations?: ReimbursementAllocation[];
}

export interface ReimbursementAllocation {
  id: string;
  settlement_group_id: string;
  expense_transaction_id: string;
  allocated_amount: number;
  created_at: string;
  // Joined
  expense_transaction?: Transaction;
}

export interface ReimbursementRule {
  id: string;
  user_id: string;
  name: string;
  is_active: boolean;
  match_criteria: {
    description_pattern?: string;
    category?: string;
    amount_min?: number;
    amount_max?: number;
    account_ids?: string[];
  };
  action: {
    auto_mark_as_shared: boolean;
    require_reimbursement: boolean;
    expected_reimbursement_percentage: number;
    notify_on_match: boolean;
  };
  created_at: string;
  last_matched_at: string | null;
}

// ─── CSV Import Types ────────────────────────────────────

export interface CsvColumnMapping {
  date_column: string;
  date_type: "purchase" | "posted";
  amount_column: string;
  amount_sign: "as_is" | "invert"; // some CSVs use positive for debits
  description_column: string;
  id_column?: string;
}

export interface CsvPreviewRow {
  [key: string]: string;
}

export interface DuplicateCandidate {
  imported_row: CsvPreviewRow;
  existing_transaction: Transaction;
  confidence: "high" | "medium";
  action: "skip" | "import";
}

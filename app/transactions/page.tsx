"use client";

export const dynamic = "force-dynamic";

import React, { useState, useEffect, useCallback } from "react";
import {
  Filter,
  ChevronDown,
  ChevronUp,
  CreditCard,
  Users,
  Heart,
  Zap,
  Tag,
  Copy,
  Trash2,
} from "lucide-react";
import { PageShell } from "@/components/layout/PageShell";
import { Button, Card, Badge, Modal, Select, useToast } from "@/components/ui";
import { createClient } from "@/lib/supabase/client";
import { formatCurrency, formatDate, cn, transactionFingerprint } from "@/lib/utils";
import type { Transaction, Account, Category, CreditCardBill, Contact } from "@/lib/types";

type ViewMode = "unified" | "perAccount";

interface Filters {
  dateFrom: string;
  dateTo: string;
  accountIds: string[];
  categoryId: string;
  sharedStatus: "all" | "shared" | "personal";
  reimbursementStatus: "all" | "unreimbursed" | "partial" | "full";
  partnerOnly: boolean;
}

const defaultFilters: Filters = {
  dateFrom: "",
  dateTo: "",
  accountIds: [],
  categoryId: "",
  sharedStatus: "all",
  reimbursementStatus: "all",
  partnerOnly: false,
};

export default function TransactionsPage() {
  const supabase = createClient();
  const { toast } = useToast();
  const [userName, setUserName] = useState("");
  const [displayCurrency, setDisplayCurrency] = useState("SEK");
  const [viewMode, setViewMode] = useState<ViewMode>("unified");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [filters, setFilters] = useState<Filters>(defaultFilters);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [selectedTxId, setSelectedTxId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [contacts, setContacts] = useState<Contact[]>([]);
  const [applyingRules, setApplyingRules] = useState(false);

  // Duplicate finder
  const [dupFinderOpen, setDupFinderOpen] = useState(false);
  const [dupGroups, setDupGroups] = useState<Transaction[][]>([]);
  const [deletingDups, setDeletingDups] = useState(false);

  // ─── Auto-categorize ──────────────────────────
  const handleAutoCategorize = async () => {
    setApplyingRules(true);
    // Fetch all categorized transactions to build a description → category map
    const { data: categorized } = await supabase
      .from("transactions")
      .select("description, category_id")
      .not("category_id", "is", null);

    if (!categorized || categorized.length === 0) {
      toast("No categorized transactions to learn from", "info");
      setApplyingRules(false);
      return;
    }

    // Build frequency map: description (lowercase) → most common category_id
    const freq = new Map<string, Map<string, number>>();
    for (const tx of categorized) {
      const key = tx.description.toLowerCase().trim();
      if (!freq.has(key)) freq.set(key, new Map());
      const m = freq.get(key)!;
      m.set(tx.category_id, (m.get(tx.category_id) || 0) + 1);
    }
    const descToCategory = new Map<string, string>();
    freq.forEach((counts, desc) => {
      const best = Array.from(counts.entries()).sort((a, b) => b[1] - a[1])[0];
      descToCategory.set(desc, best[0]);
    });

    // Find uncategorized transactions in current view and apply matches
    const uncategorized = transactions.filter((t) => !t.category_id);
    const descToCatEntries = Array.from(descToCategory.entries());
    let updated = 0;
    for (const tx of uncategorized) {
      const key = tx.description.toLowerCase().trim();
      // Exact match first
      let catId = descToCategory.get(key);
      // Substring match: check if any known description is contained in this one or vice versa
      if (!catId) {
        for (const [desc, cId] of descToCatEntries) {
          if (key.includes(desc) || desc.includes(key)) {
            catId = cId;
            break;
          }
        }
      }
      if (catId) {
        await supabase.from("transactions").update({ category_id: catId }).eq("id", tx.id);
        updated++;
      }
    }

    toast(updated > 0 ? `Auto-categorized ${updated} transactions` : "No new matches found", updated > 0 ? "success" : "info");
    setApplyingRules(false);
    fetchTransactions();
  };

  // ─── Apply sharing rules ──────────────────────
  const handleApplyRules = async () => {
    let rules: { id: string; keyword: string; markShared: boolean; categoryId: string }[] = [];
    try {
      const stored = localStorage.getItem("sq_auto_rules");
      if (stored) rules = JSON.parse(stored);
    } catch { /* ignore */ }

    if (rules.length === 0) {
      toast("No rules defined. Add rules in Settings → Auto Rules.", "info");
      return;
    }

    setApplyingRules(true);
    let updated = 0;
    for (const tx of transactions) {
      const desc = tx.description.toLowerCase();
      for (const rule of rules) {
        if (desc.includes(rule.keyword.toLowerCase())) {
          const patch: Record<string, unknown> = {};
          if (rule.markShared && !tx.is_shared) {
            patch.is_shared = true;
            patch.reimbursement_status = "pending";
          }
          if (rule.categoryId && !tx.category_id) {
            patch.category_id = rule.categoryId;
          }
          if (Object.keys(patch).length > 0) {
            await supabase.from("transactions").update(patch).eq("id", tx.id);
            updated++;
          }
          break; // first matching rule wins
        }
      }
    }

    toast(updated > 0 ? `Applied rules to ${updated} transactions` : "No changes needed", updated > 0 ? "success" : "info");
    setApplyingRules(false);
    fetchTransactions();
  };

  // ─── Duplicate Finder ────────────────────────
  const handleFindDuplicates = () => {
    const sensitivity = (() => { try { return localStorage.getItem("sq_dup_sensitivity") || "strict"; } catch { return "strict"; } })();
    const groups = new Map<string, Transaction[]>();
    for (const tx of transactions) {
      const fp = sensitivity === "loose"
        ? `${tx.date}|${tx.amount}`
        : transactionFingerprint(tx.date, tx.amount, tx.description);
      if (!groups.has(fp)) groups.set(fp, []);
      groups.get(fp)!.push(tx);
    }
    const dupes = Array.from(groups.values()).filter((g) => g.length > 1);
    setDupGroups(dupes);
    setDupFinderOpen(true);
  };

  const handleDeleteDuplicate = async (txId: string) => {
    setDeletingDups(true);
    await supabase.from("transactions").delete().eq("id", txId);
    setDupGroups((prev) =>
      prev.map((g) => g.filter((t) => t.id !== txId)).filter((g) => g.length > 1)
    );
    setDeletingDups(false);
    fetchTransactions();
  };

  const handleDeleteAllButFirst = async (group: Transaction[]) => {
    setDeletingDups(true);
    const toDelete = group.slice(1).map((t) => t.id);
    await supabase.from("transactions").delete().in("id", toDelete);
    setDupGroups((prev) =>
      prev.map((g) => (g[0].id === group[0].id ? [g[0]] : g)).filter((g) => g.length > 1)
    );
    setDeletingDups(false);
    fetchTransactions();
  };

  const handleRemoveAllDuplicates = async () => {
    setDeletingDups(true);
    const toDelete = dupGroups.flatMap((g) => g.slice(1).map((t) => t.id));
    await supabase.from("transactions").delete().in("id", toDelete);
    setDupGroups([]);
    setDeletingDups(false);
    fetchTransactions();
  };

  // CC Bill modal
  const [ccModalOpen, setCcModalOpen] = useState(false);
  const [ccModalTxId, setCcModalTxId] = useState<string | null>(null);
  const [ccTargetAccount, setCcTargetAccount] = useState("");
  const [ccStartDate, setCcStartDate] = useState("");
  const [ccEndDate, setCcEndDate] = useState("");

  // CC Bills for exploding in unified view
  const [ccBills, setCcBills] = useState<CreditCardBill[]>([]);

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        setUserName(user.user_metadata?.name || user.email || "");
        const { data: profile } = await supabase.from("profiles").select("default_currency").eq("id", user.id).single();
        if (profile?.default_currency) setDisplayCurrency(profile.default_currency);
      }
      const { data: accts } = await supabase.from("accounts").select("*").eq("is_active", true).order("name");
      if (accts) setAccounts(accts);
      const { data: cats } = await supabase.from("categories").select("*").order("name");
      if (cats) setCategories(cats);
      const { data: bills } = await supabase.from("credit_card_bills").select("*");
      if (bills) setCcBills(bills);
      const { data: cts, error: ctsErr } = await supabase.from("contacts").select("*");
      console.log("contacts loaded:", cts, "error:", ctsErr);
      if (cts) setContacts(cts);
    })();
  }, [supabase]);

  const fetchTransactions = useCallback(async () => {
    setLoading(true);
    let query = supabase
      .from("transactions")
      .select("*, category:categories(*), account:accounts!account_id(*)")
      .neq("transaction_type", "cc_payment")
      .order("date", { ascending: false });

    if (filters.dateFrom) query = query.gte("date", filters.dateFrom);
    if (filters.dateTo) query = query.lte("date", filters.dateTo);
    if (filters.accountIds.length > 0) query = query.in("account_id", filters.accountIds);
    if (filters.categoryId) query = query.eq("category_id", filters.categoryId);
    if (filters.sharedStatus === "shared") query = query.eq("is_shared", true);
    if (filters.sharedStatus === "personal") query = query.eq("is_shared", false);
    if (filters.reimbursementStatus === "unreimbursed") query = query.eq("reimbursement_status", "pending");
    if (filters.reimbursementStatus === "partial") query = query.eq("reimbursement_status", "partial");
    if (filters.reimbursementStatus === "full") query = query.eq("reimbursement_status", "full");
    if (filters.partnerOnly) query = query.eq("is_partner_transfer", true);

    const { data, error } = await query;
    if (error) console.error("transactions fetch error:", error);
    if (data) setTransactions(data);
    setLoading(false);
  }, [supabase, filters]);

  useEffect(() => {
    fetchTransactions();
  }, [fetchTransactions]);

  // ─── Unified View Logic ──────────────────────
  const getUnifiedTransactions = (): Transaction[] => {
    // In unified view:
    // 1. CC payments (cc_payment type) are shown as transfers, not expenses
    // 2. Shared account transactions show 50% amount
    // 3. Credit card charges within a bill are "exploded" to their purchase dates
    return transactions.map((tx) => {
      const account = tx.account as Account | undefined;
      if (account?.type === "shared" && tx.is_shared) {
        return { ...tx, amount: tx.amount * 0.5 };
      }
      return tx;
    });
  };

  // ─── Per-Account Grouped ─────────────────────
  const getGroupedTransactions = (): Map<string, Transaction[]> => {
    const groups = new Map<string, Transaction[]>();
    for (const tx of transactions) {
      const acctId = tx.account_id;
      if (!groups.has(acctId)) groups.set(acctId, []);
      groups.get(acctId)!.push(tx);
    }
    return groups;
  };

  const selectedTx = transactions.find((t) => t.id === selectedTxId);

  // ─── Contact resolution ───────────────────────
  // Normalize a phone/identifier to digits only, stripped of country prefix
  const normalizePhone = (s: string): string => {
    const digits = s.replace(/\D/g, "");
    if (digits.startsWith("46") && digits.length === 11) return digits.slice(2); // 46XXXXXXXXX → 9 digits
    if (digits.startsWith("0") && digits.length === 10) return digits.slice(1);  // 0XXXXXXXXX → 9 digits
    return digits;
  };

  // Build identifier → contact map
  const contactByIdentifier = new Map<string, Contact>();
  for (const c of contacts) {
    for (const raw of [c.swish_number, c.venmo_handle, c.zelle_email, c.other_payment_app_identifier]) {
      if (!raw) continue;
      contactByIdentifier.set(normalizePhone(raw), c);
      contactByIdentifier.set(raw.toLowerCase().trim(), c); // also try exact
    }
  }

  const resolveContact = (description: string): Contact | null => {
    const descDigits = description.replace(/\D/g, "");
    for (const [key, contact] of Array.from(contactByIdentifier.entries())) {
      if (key.length >= 6 && descDigits.includes(key)) return contact;
      if (key.length >= 4 && description.toLowerCase().includes(key)) return contact;
    }
    return null;
  };

  // ─── Transaction Row ─────────────────────────
  const renderTxRow = (tx: Transaction, showAccount: boolean = true) => {
    const account = tx.account as Account | undefined;
    const category = tx.category as Category | undefined;
    const isSelected = selectedTxId === tx.id;
    const isPartner = tx.is_partner_transfer;
    const isCC = account?.type === "credit_card";
    const isShared = tx.is_shared;
    const matchedContact = resolveContact(tx.description);

    return (
      <div key={tx.id}>
        <div
          onClick={() => setSelectedTxId(isSelected ? null : tx.id)}
          className={cn(
            "grid grid-cols-12 gap-4 px-6 py-3 border-b border-sq-gray-100 items-center cursor-pointer transition-colors",
            isSelected && "bg-sq-gray-100",
            isPartner && "bg-purple-50 border-l-4 border-l-sq-purple",
            !isSelected && !isPartner && "hover:bg-sq-gray-100"
          )}
        >
          {/* Date */}
          <div className="col-span-2 font-mono text-[13px] text-sq-gray-600">
            {formatDate(tx.date)}
          </div>
          {/* Description + badges */}
          <div className={cn("flex items-center gap-2 flex-wrap", showAccount ? "col-span-4" : "col-span-5")}>
            {matchedContact ? (
              <span className="flex flex-col min-w-0">
                <span className="font-sans text-[14px] font-semibold text-sq-black truncate">
                  {matchedContact.name}
                </span>
                <span className="font-sans text-[11px] text-sq-gray-400 truncate">
                  {tx.description}
                </span>
              </span>
            ) : (
              <span className="font-sans text-[14px] text-sq-black truncate">{tx.description}</span>
            )}
            {isCC && viewMode === "unified" && (
              <Badge variant="cc" icon={<CreditCard className="w-3 h-3" />}>
                CC: {account?.name?.split(" ")[0]}
              </Badge>
            )}
            {isShared && (
              <Badge variant="shared" icon={<Users className="w-3 h-3" />}>
                Shared{viewMode === "unified" ? " (50%)" : ""}
              </Badge>
            )}
            {isPartner && (
              <Badge variant="partner" icon={<Heart className="w-3 h-3" />}>
                Partner Transfer
              </Badge>
            )}
          </div>
          {/* Account */}
          {showAccount && (
            <div className="col-span-2 font-sans text-[12px] text-sq-gray-600 uppercase tracking-wider truncate">
              {account?.name || "—"}
            </div>
          )}
          {/* Category */}
          <div className="col-span-2 flex items-center gap-1.5">
            {category ? (
              <>
                <div
                  className="w-2.5 h-2.5 rounded-full"
                  style={{ backgroundColor: category.color || "#D4D4D4" }}
                />
                <span className="font-sans text-[12px] text-sq-gray-600">{category.name}</span>
              </>
            ) : (
              <span className="font-sans text-[12px] text-sq-gray-400 italic">Uncategorized</span>
            )}
          </div>
          {/* Amount */}
          <div className={cn(
            "col-span-2 text-right font-mono text-[14px] font-bold",
            isPartner ? "text-sq-purple" : tx.amount < 0 ? "text-sq-green" : "text-sq-red"
          )}>
            {formatCurrency(
              Math.abs(viewMode === "unified" && (tx.account as Account)?.type === "shared" && tx.is_shared
                ? tx.amount * 0.5
                : tx.amount),
              tx.currency || displayCurrency
            )}
          </div>
        </div>

        {/* Detail panel */}
        {isSelected && selectedTx && (
          <TransactionDetailPanel
            tx={selectedTx}
            categories={categories}
            supabase={supabase}
            onUpdate={fetchTransactions}
            onClose={() => setSelectedTxId(null)}
            onOpenCcModal={() => {
              setCcModalTxId(tx.id);
              setCcModalOpen(true);
            }}
          />
        )}
      </div>
    );
  };

  // ─── Filter Bar ──────────────────────────────
  const renderFilters = () => (
    <div className="border-b border-sq-black bg-[#F9F9F9] px-6 py-4">
      <div className="grid grid-cols-6 gap-4 items-end">
        <div>
          <label className="block sq-label-muted mb-1">From</label>
          <input
            type="date"
            value={filters.dateFrom}
            onChange={(e) => setFilters({ ...filters, dateFrom: e.target.value })}
            className="w-full border-2 border-sq-black px-3 py-2 font-mono text-[13px] outline-none focus:border-sq-blue"
          />
        </div>
        <div>
          <label className="block sq-label-muted mb-1">To</label>
          <input
            type="date"
            value={filters.dateTo}
            onChange={(e) => setFilters({ ...filters, dateTo: e.target.value })}
            className="w-full border-2 border-sq-black px-3 py-2 font-mono text-[13px] outline-none focus:border-sq-blue"
          />
        </div>
        <div>
          <label className="block sq-label-muted mb-1">Category</label>
          <select
            value={filters.categoryId}
            onChange={(e) => setFilters({ ...filters, categoryId: e.target.value })}
            className="w-full border-2 border-sq-black px-3 py-2 font-sans text-[13px] outline-none focus:border-sq-blue"
          >
            <option value="">All Categories</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block sq-label-muted mb-1">Shared</label>
          <select
            value={filters.sharedStatus}
            onChange={(e) => setFilters({ ...filters, sharedStatus: e.target.value as any })}
            className="w-full border-2 border-sq-black px-3 py-2 font-sans text-[13px] outline-none focus:border-sq-blue"
          >
            <option value="all">All</option>
            <option value="shared">Shared Only</option>
            <option value="personal">Personal Only</option>
          </select>
        </div>
        <div>
          <label className="block sq-label-muted mb-1">Reimbursement</label>
          <select
            value={filters.reimbursementStatus}
            onChange={(e) => setFilters({ ...filters, reimbursementStatus: e.target.value as any })}
            className="w-full border-2 border-sq-black px-3 py-2 font-sans text-[13px] outline-none focus:border-sq-blue"
          >
            <option value="all">All</option>
            <option value="unreimbursed">Unreimbursed</option>
            <option value="partial">Partial</option>
            <option value="full">Full</option>
          </select>
        </div>
        <div className="flex items-end gap-2">
          <button
            onClick={() => setFilters({ ...filters, partnerOnly: !filters.partnerOnly })}
            className={cn(
              "flex-1 border-2 py-2 font-sans font-semibold text-[11px] uppercase tracking-wider flex items-center justify-center gap-1 transition-colors",
              filters.partnerOnly
                ? "bg-sq-purple text-sq-white border-sq-purple"
                : "border-sq-black text-sq-black hover:bg-sq-gray-100"
            )}
          >
            <Heart className="w-3 h-3" />
            Partner
          </button>
          <button
            onClick={() => setFilters(defaultFilters)}
            className="px-3 py-2 border-2 border-sq-black font-sans text-[11px] uppercase font-semibold text-sq-gray-600 hover:text-sq-black"
          >
            Clear
          </button>
        </div>
      </div>
    </div>
  );

  // ─── CC Bill Modal ───────────────────────────
  const handleCreateCcBill = async () => {
    if (!ccModalTxId || !ccTargetAccount || !ccStartDate || !ccEndDate) return;
    const tx = transactions.find((t) => t.id === ccModalTxId);
    if (!tx) return;
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    // Update transaction type to cc_payment
    await supabase.from("transactions").update({ transaction_type: "cc_payment" }).eq("id", ccModalTxId);

    // Create CC bill record
    await supabase.from("credit_card_bills").insert({
      user_id: user.id,
      payment_transaction_id: ccModalTxId,
      credit_card_account_id: ccTargetAccount,
      statement_start_date: ccStartDate,
      statement_end_date: ccEndDate,
      total_amount: Math.abs(tx.amount),
    });

    setCcModalOpen(false);
    setCcModalTxId(null);
    setCcTargetAccount("");
    setCcStartDate("");
    setCcEndDate("");
    toast("CC bill created");
    fetchTransactions();
  };

  // ─── Table Header ────────────────────────────
  const renderTableHeader = (showAccount: boolean = true) => (
    <div className="grid grid-cols-12 gap-4 px-6 py-3 bg-sq-gray-100 border-b border-sq-black">
      <div className="col-span-2 sq-label-muted">Date</div>
      <div className={cn("sq-label-muted", showAccount ? "col-span-4" : "col-span-5")}>Description</div>
      {showAccount && <div className="col-span-2 sq-label-muted">Account</div>}
      <div className="col-span-2 sq-label-muted">Category</div>
      <div className="col-span-2 text-right sq-label-muted">Amount</div>
    </div>
  );

  return (
    <PageShell userName={userName}>
      {/* Title + View Toggle */}
      <div className="flex justify-between items-center mb-0 -mx-12 -mt-12 px-6 py-4 border-b border-sq-black">
        <h1 className="font-sans font-extrabold text-[28px] text-sq-black uppercase tracking-tight">
          Transactions
        </h1>
        <div className="flex items-center gap-6">
          <span className="sq-label-muted">View Mode</span>
          <div className="flex border-2 border-sq-black">
            <button
              onClick={() => setViewMode("perAccount")}
              className={cn(
                "px-4 py-2 font-sans font-semibold text-[12px] uppercase tracking-wider transition-colors",
                viewMode === "perAccount" ? "bg-sq-black text-sq-white" : "text-sq-gray-600 hover:text-sq-black"
              )}
            >
              Per Account
            </button>
            <button
              onClick={() => setViewMode("unified")}
              className={cn(
                "px-4 py-2 font-sans font-semibold text-[12px] uppercase tracking-wider transition-colors",
                viewMode === "unified" ? "bg-sq-black text-sq-white" : "text-sq-gray-600 hover:text-sq-black"
              )}
            >
              Unified
            </button>
          </div>
          <button
            onClick={() => setFiltersOpen(!filtersOpen)}
            className={cn(
              "flex items-center gap-2 px-4 py-2 border-2 font-sans font-semibold text-[12px] uppercase tracking-wider transition-colors",
              filtersOpen ? "border-sq-black bg-sq-black text-sq-white" : "border-sq-black text-sq-black hover:bg-sq-gray-100"
            )}
          >
            <Filter className="w-4 h-4" />
            Filters
            {filtersOpen ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          </button>
        </div>
      </div>

      {/* Filter bar */}
      {filtersOpen && <div className="-mx-12">{renderFilters()}</div>}

      {/* Transaction count + actions */}
      <div className="flex justify-between items-center py-4">
        <span className="font-mono text-[13px] text-sq-gray-600">
          {loading ? "Loading…" : `${transactions.length} transactions`}
        </span>
        <div className="flex gap-3">
          <button
            onClick={handleAutoCategorize}
            disabled={applyingRules || loading}
            className="flex items-center gap-1.5 px-3 py-1.5 border-2 border-sq-black font-sans font-semibold text-[11px] uppercase tracking-wider text-sq-black hover:bg-sq-gray-100 disabled:opacity-40 transition-colors"
          >
            <Tag className="w-3 h-3" />
            Auto-categorize
          </button>
          <button
            onClick={handleApplyRules}
            disabled={applyingRules || loading}
            className="flex items-center gap-1.5 px-3 py-1.5 border-2 border-sq-black font-sans font-semibold text-[11px] uppercase tracking-wider text-sq-black hover:bg-sq-gray-100 disabled:opacity-40 transition-colors"
          >
            <Zap className="w-3 h-3" />
            Apply Rules
          </button>
          <button
            onClick={handleFindDuplicates}
            disabled={loading}
            className="flex items-center gap-1.5 px-3 py-1.5 border-2 border-sq-red font-sans font-semibold text-[11px] uppercase tracking-wider text-sq-red hover:bg-red-50 disabled:opacity-40 transition-colors"
          >
            <Copy className="w-3 h-3" />
            Find Duplicates
          </button>
        </div>
      </div>

      {/* Transaction list */}
      <div className="border border-sq-black -mx-12">
        {viewMode === "unified" ? (
          <>
            {renderTableHeader(true)}
            {transactions.length === 0 && !loading ? (
              <div className="px-6 py-12 text-center text-sq-gray-600 font-sans text-[14px]">
                No transactions found. Import a CSV to get started.
              </div>
            ) : (
              getUnifiedTransactions().map((tx) => renderTxRow(tx, true))
            )}
          </>
        ) : (
          Array.from(getGroupedTransactions().entries()).map(([accountId, txs]) => {
            const acct = accounts.find((a) => a.id === accountId);
            return (
              <div key={accountId}>
                <div className="bg-sq-gray-100 border-b border-sq-black px-6 py-3 flex items-center gap-3">
                  <CreditCard className="w-4 h-4 text-sq-gray-600" />
                  <span className="font-sans font-bold text-[14px] uppercase tracking-wider text-sq-black">
                    {acct?.name || "Unknown Account"}
                  </span>
                  <span className="font-mono text-[12px] text-sq-gray-600">
                    ({txs.length} transactions)
                  </span>
                </div>
                {renderTableHeader(false)}
                {txs.map((tx) => renderTxRow(tx, false))}
              </div>
            );
          })
        )}
      </div>

      {/* Duplicate Finder Modal */}
      <Modal isOpen={dupFinderOpen} onClose={() => setDupFinderOpen(false)} title="Duplicate Transactions">
        {dupGroups.length === 0 ? (
          <div className="text-center py-8">
            <p className="font-sans font-semibold text-[15px] text-sq-black mb-1">No duplicates found!</p>
            <p className="font-sans text-[13px] text-sq-gray-600">All {transactions.length} transactions appear unique.</p>
          </div>
        ) : (
          <div>
            <div className="flex justify-between items-center mb-4">
              <p className="font-sans text-[13px] text-sq-gray-600">
                Found {dupGroups.length} group{dupGroups.length !== 1 ? "s" : ""} of duplicates.
                Keep the first occurrence and delete the rest, or remove individually.
              </p>
              <button
                onClick={handleRemoveAllDuplicates}
                disabled={deletingDups}
                className="flex-shrink-0 ml-4 px-3 py-1.5 bg-sq-red text-sq-white font-sans font-semibold text-[11px] uppercase tracking-wider hover:opacity-80 disabled:opacity-40 transition-opacity"
              >
                Remove All Duplicates
              </button>
            </div>
            <div className="space-y-4 max-h-[60vh] overflow-y-auto">
              {dupGroups.map((group, gi) => (
                <div key={gi} className="border-2 border-sq-black">
                  <div className="flex justify-between items-center px-4 py-2 bg-sq-gray-100 border-b border-sq-black">
                    <span className="font-sans text-[12px] font-semibold text-sq-black uppercase tracking-wider">
                      {group[0].description} · {formatDate(group[0].date)} · {formatCurrency(Math.abs(group[0].amount), group[0].currency || displayCurrency)}
                    </span>
                    <button
                      onClick={() => handleDeleteAllButFirst(group)}
                      disabled={deletingDups}
                      className="font-sans text-[11px] font-semibold uppercase tracking-wider text-sq-red hover:underline disabled:opacity-40"
                    >
                      Keep first, delete {group.length - 1} duplicate{group.length - 1 !== 1 ? "s" : ""}
                    </button>
                  </div>
                  {group.map((tx, ti) => (
                    <div key={tx.id} className="flex justify-between items-center px-4 py-2 border-b border-sq-gray-100 last:border-0">
                      <div className="flex items-center gap-3">
                        {ti === 0 && (
                          <span className="font-sans text-[10px] uppercase tracking-wider text-sq-green font-semibold border border-sq-green px-1.5 py-0.5">Keep</span>
                        )}
                        <span className="font-mono text-[12px] text-sq-gray-600">{formatDate(tx.date)}</span>
                        <span className="font-sans text-[13px] text-sq-black truncate max-w-[200px]">{tx.description}</span>
                        <span className="font-mono text-[13px] font-bold text-sq-red">{formatCurrency(Math.abs(tx.amount), tx.currency || displayCurrency)}</span>
                      </div>
                      {ti > 0 && (
                        <button
                          onClick={() => handleDeleteDuplicate(tx.id)}
                          disabled={deletingDups}
                          className="text-sq-gray-400 hover:text-sq-red disabled:opacity-40 transition-colors"
                          title="Delete this duplicate"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>
        )}
      </Modal>

      {/* CC Bill Modal */}
      <Modal isOpen={ccModalOpen} onClose={() => setCcModalOpen(false)} title="CC Bill Reconciliation">
        <Select
          label="Credit Card Account"
          value={ccTargetAccount}
          onChange={(e) => setCcTargetAccount(e.target.value)}
          options={[
            { value: "", label: "Select credit card account…" },
            ...accounts.filter((a) => a.type === "credit_card").map((a) => ({ value: a.id, label: a.name })),
          ]}
        />
        <div className="grid grid-cols-2 gap-4">
          <div className="mb-6">
            <label className="block sq-label mb-2">Statement Start Date</label>
            <input
              type="date"
              value={ccStartDate}
              onChange={(e) => setCcStartDate(e.target.value)}
              className="w-full border-2 border-sq-black px-4 py-3 font-mono text-[15px] outline-none focus:border-sq-blue"
            />
          </div>
          <div className="mb-6">
            <label className="block sq-label mb-2">Statement End Date</label>
            <input
              type="date"
              value={ccEndDate}
              onChange={(e) => setCcEndDate(e.target.value)}
              className="w-full border-2 border-sq-black px-4 py-3 font-mono text-[15px] outline-none focus:border-sq-blue"
            />
          </div>
        </div>
        <div className="flex justify-end gap-4">
          <Button variant="ghost" onClick={() => setCcModalOpen(false)}>Cancel</Button>
          <Button onClick={handleCreateCcBill} disabled={!ccTargetAccount || !ccStartDate || !ccEndDate}>
            Create Bill
          </Button>
        </div>
      </Modal>
    </PageShell>
  );
}

// ─── Transaction Detail Panel ──────────────────
function TransactionDetailPanel({
  tx,
  categories,
  supabase,
  onUpdate,
  onClose,
  onOpenCcModal,
}: {
  tx: Transaction;
  categories: Category[];
  supabase: any;
  onUpdate: () => void;
  onClose: () => void;
  onOpenCcModal: () => void;
}) {
  const { toast } = useToast();
  const [categoryId, setCategoryId] = useState(tx.category_id || "");
  const [isShared, setIsShared] = useState(tx.is_shared);
  const [notes, setNotes] = useState(tx.notes || "");
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    const { error } = await supabase
      .from("transactions")
      .update({
        category_id: categoryId || null,
        is_shared: isShared,
        notes: notes || null,
        reimbursement_status: isShared ? "pending" : "none",
      })
      .eq("id", tx.id);
    setSaving(false);
    if (error) toast("Failed to save", "error");
    else toast("Transaction saved");
    onUpdate();
  };

  return (
    <div className="bg-sq-gray-100 border-b border-sq-black px-6 py-6">
      <div className="grid grid-cols-3 gap-6">
        {/* Left: Details */}
        <div>
          <div className="sq-label-muted mb-1">Raw Description</div>
          <div className="font-mono text-[13px] text-sq-black mb-4">{tx.raw_description || tx.description}</div>
          {tx.posted_date && (
            <>
              <div className="sq-label-muted mb-1">Posted Date</div>
              <div className="font-mono text-[13px] text-sq-black mb-4">{formatDate(tx.posted_date)}</div>
            </>
          )}
          <div className="sq-label-muted mb-1">Type</div>
          <div className="font-sans text-[13px] text-sq-black capitalize mb-4">
            {tx.transaction_type.replace("_", " ")}
          </div>
        </div>

        {/* Middle: Categorization */}
        <div>
          <div className="mb-4">
            <label className="block sq-label-muted mb-1">Category</label>
            <select
              value={categoryId}
              onChange={(e) => setCategoryId(e.target.value)}
              className="w-full border-2 border-sq-black px-3 py-2 font-sans text-[13px] outline-none focus:border-sq-blue bg-sq-white"
            >
              <option value="">Uncategorized</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
          <div className="mb-4">
            <label className="block sq-label-muted mb-1">Shared Expense</label>
            <button
              onClick={() => setIsShared(!isShared)}
              className={cn(
                "w-full border-2 py-2 font-sans font-semibold text-[12px] uppercase tracking-wider transition-colors flex items-center justify-center gap-2",
                isShared ? "bg-amber-500 text-sq-white border-amber-500" : "border-sq-black text-sq-black hover:bg-sq-gray-100"
              )}
            >
              <Users className="w-3 h-3" />
              {isShared ? "Shared — Yes" : "Mark as Shared"}
            </button>
          </div>
        </div>

        {/* Right: Notes + Actions */}
        <div>
          <div className="mb-4">
            <label className="block sq-label-muted mb-1">Notes</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              className="w-full border-2 border-sq-black px-3 py-2 font-sans text-[13px] outline-none focus:border-sq-blue bg-sq-white resize-none"
              placeholder="Add a note…"
            />
          </div>
          <div className="flex gap-2 flex-wrap">
            <Button size="sm" onClick={handleSave} disabled={saving}>
              {saving ? "Saving…" : "Save"}
            </Button>
            {tx.transaction_type !== "internal_transfer" ? (
              <Button
                size="sm"
                variant="secondary"
                onClick={async () => {
                  await supabase.from("transactions").update({ transaction_type: "internal_transfer" }).eq("id", tx.id);
                  onUpdate();
                }}
              >
                Mark Internal Transfer
              </Button>
            ) : (
              <Button
                size="sm"
                variant="secondary"
                onClick={async () => {
                  const type = tx.amount > 0 ? "expense" : "income";
                  await supabase.from("transactions").update({ transaction_type: type }).eq("id", tx.id);
                  onUpdate();
                }}
              >
                Unmark Internal Transfer
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

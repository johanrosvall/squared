"use client";

export const dynamic = "force-dynamic";

import React, { useState, useEffect, useCallback, useMemo } from "react";
import {
  Plus,
  Landmark,
  CreditCard,
  Users,
  PiggyBank,
  History,
  ArrowLeft,
  Archive,
  ArchiveRestore,
  Trash2,
  Check,
  X,
  Link,
  Unlink,
  AlertTriangle,
} from "lucide-react";
import { PageShell } from "@/components/layout/PageShell";
import { Button, Card, Input, Select, useToast } from "@/components/ui";
import { createClient } from "@/lib/supabase/client";
import { formatDate, formatCurrency, cn } from "@/lib/utils";
import type { Account, AccountType, ImportBatch, CreditCardBill, Transaction } from "@/lib/types";

const accountTypeIcon: Record<string, React.ReactNode> = {
  checking: <Landmark className="w-6 h-6 text-sq-black" />,
  savings: <PiggyBank className="w-6 h-6 text-sq-black" />,
  credit_card: <CreditCard className="w-6 h-6 text-sq-black" />,
  shared: <Users className="w-6 h-6 text-sq-black" />,
  other: <Landmark className="w-6 h-6 text-sq-black" />,
};

// Keywords that identify CC bill payments in a checking account
const CC_PAYMENT_KEYWORDS = ["seb kort", "kortbetalning", "kreditkort", "cc payment", "credit card payment"];

function lastDayOfMonth(yearMonth: string): string {
  const [y, m] = yearMonth.split("-").map(Number);
  return new Date(y, m, 0).toISOString().slice(0, 10);
}

function daysBetween(a: string, b: string): number {
  return Math.round((new Date(b).getTime() - new Date(a).getTime()) / 86400000);
}

interface BillingPeriod {
  month: string; // "2025-01"
  startDate: string;
  endDate: string;
  totalCharges: number;
  chargeCount: number;
  // Matched/confirmed payment
  confirmedBill: CreditCardBill | null;
  // Auto-suggestion
  suggestedPayment: { tx: Transaction; delta: number } | null;
}

function detectBillingPeriods(
  ccTxs: Transaction[],
  paymentCandidates: Transaction[],
  existingBills: CreditCardBill[]
): BillingPeriod[] {
  const byMonth = new Map<string, Transaction[]>();
  for (const tx of ccTxs) {
    const month = tx.date.slice(0, 7);
    if (!byMonth.has(month)) byMonth.set(month, []);
    byMonth.get(month)!.push(tx);
  }

  return Array.from(byMonth.entries())
    .map(([month, txs]) => {
      const startDate = `${month}-01`;
      const endDate = lastDayOfMonth(month);
      const totalCharges = txs.reduce((s, t) => s + Math.abs(t.amount), 0);

      const confirmedBill = existingBills.find(
        (b) => b.statement_start_date === startDate || b.statement_end_date === endDate
      ) ?? null;

      // Auto-suggest: look for payment 0–75 days after billing period end, amount within 5%
      let suggestedPayment: { tx: Transaction; delta: number } | null = null;
      if (!confirmedBill) {
        const scored = paymentCandidates
          .map((tx) => ({
            tx,
            daysAfter: daysBetween(endDate, tx.date),
            delta: Math.abs(Math.abs(tx.amount) - totalCharges),
          }))
          .filter(({ daysAfter, delta }) => daysAfter >= 0 && daysAfter <= 75 && delta / totalCharges < 0.08)
          .sort((a, b) => a.delta - b.delta || a.daysAfter - b.daysAfter);
        if (scored.length > 0) suggestedPayment = { tx: scored[0].tx, delta: scored[0].delta };
      }

      return { month, startDate, endDate, totalCharges, chargeCount: txs.length, confirmedBill, suggestedPayment };
    })
    .sort((a, b) => b.month.localeCompare(a.month));
}

type ViewState =
  | { mode: "gallery" }
  | { mode: "create" }
  | { mode: "history"; accountId: string; accountName: string }
  | { mode: "cc_billing"; accountId: string; accountName: string };

export default function AccountsPage() {
  const supabase = createClient();
  const { toast } = useToast();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [view, setView] = useState<ViewState>({ mode: "gallery" });
  const [userName, setUserName] = useState("");

  // Create form
  const [newName, setNewName] = useState("");
  const [newType, setNewType] = useState<AccountType>("checking");
  const [newCurrency, setNewCurrency] = useState("USD");
  const [creating, setCreating] = useState(false);

  // Import history
  const [batches, setBatches] = useState<ImportBatch[]>([]);

  // CC billing state
  const [ccTxs, setCcTxs] = useState<Transaction[]>([]);
  const [paymentCandidates, setPaymentCandidates] = useState<Transaction[]>([]);
  const [existingBills, setExistingBills] = useState<CreditCardBill[]>([]);
  const [ccLoading, setCcLoading] = useState(false);
  // Per-period: which payment is being selected (picker open)
  const [pickingForMonth, setPickingForMonth] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);

  const fetchAccounts = useCallback(async () => {
    const { data } = await supabase.from("accounts").select("*").order("created_at");
    if (data) setAccounts(data);
  }, [supabase]);

  useEffect(() => {
    fetchAccounts();
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user) setUserName(user.user_metadata?.name || user.email || "");
    });
  }, [fetchAccounts, supabase]);

  // ─── Load CC billing data ─────────────────────
  const loadCCBilling = useCallback(async (accountId: string) => {
    setCcLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    // All transactions for this CC account
    const { data: ccData } = await supabase
      .from("transactions")
      .select("*")
      .eq("account_id", accountId)
      .neq("transaction_type", "cc_payment")
      .order("date", { ascending: true });

    // All checking/savings account transactions that look like CC payments
    const checkingAccounts = accounts.filter((a) => a.type === "checking" || a.type === "savings");
    let candidates: Transaction[] = [];
    if (checkingAccounts.length > 0) {
      const { data: candData } = await supabase
        .from("transactions")
        .select("*")
        .in("account_id", checkingAccounts.map((a) => a.id))
        .order("date", { ascending: true });
      if (candData) {
        candidates = candData.filter((tx) =>
          CC_PAYMENT_KEYWORDS.some((kw) => tx.description.toLowerCase().includes(kw))
        );
      }
    }

    // Existing confirmed bills for this CC account
    const { data: billData } = await supabase
      .from("credit_card_bills")
      .select("*, payment_transaction:transactions(*)")
      .eq("credit_card_account_id", accountId);

    setCcTxs(ccData || []);
    setPaymentCandidates(candidates);
    setExistingBills(billData || []);
    setCcLoading(false);
  }, [supabase, accounts]);

  const billingPeriods = useMemo(
    () => detectBillingPeriods(ccTxs, paymentCandidates, existingBills),
    [ccTxs, paymentCandidates, existingBills]
  );

  // ─── Confirm a mapping (auto-suggested or picker) ────
  const handleConfirm = async (period: BillingPeriod, paymentTxId: string) => {
    if (view.mode !== "cc_billing") return;
    setSaving(period.month);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const existing = period.confirmedBill;
    if (existing) {
      await supabase.from("credit_card_bills").update({
        payment_transaction_id: paymentTxId,
        total_amount: period.totalCharges,
      }).eq("id", existing.id);
    } else {
      await supabase.from("credit_card_bills").insert({
        user_id: user.id,
        credit_card_account_id: view.accountId,
        payment_transaction_id: paymentTxId,
        statement_start_date: period.startDate,
        statement_end_date: period.endDate,
        total_amount: period.totalCharges,
        is_exploded: false,
      });
    }
    // Mark payment transaction as cc_payment type
    await supabase.from("transactions").update({ transaction_type: "cc_payment" }).eq("id", paymentTxId);

    setPickingForMonth(null);
    toast("Mapping saved");
    await loadCCBilling(view.accountId);
    setSaving(null);
  };

  // ─── Unlink a mapping ────────────────────────
  const handleUnlink = async (period: BillingPeriod) => {
    if (!period.confirmedBill) return;
    setSaving(period.month);
    const bill = period.confirmedBill;
    // Reset payment transaction type
    if (bill.payment_transaction_id) {
      await supabase.from("transactions").update({ transaction_type: "expense" }).eq("id", bill.payment_transaction_id);
    }
    await supabase.from("credit_card_bills").delete().eq("id", bill.id);
    toast("Mapping removed");
    if (view.mode === "cc_billing") await loadCCBilling(view.accountId);
    setSaving(null);
  };

  // ─── Account actions ─────────────────────────
  const handleCreate = async () => {
    if (!newName.trim()) return;
    setCreating(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { error } = await supabase.from("accounts").insert({
      user_id: user.id,
      name: newName.trim(),
      type: newType,
      currency: newCurrency,
    });
    setCreating(false);
    if (error) { toast(`Failed to create account: ${error.message}`, "error"); return; }
    setNewName(""); setNewType("checking");
    toast("Account created");
    await fetchAccounts();
    setView({ mode: "gallery" });
  };

  const loadHistory = async (accountId: string) => {
    const { data } = await supabase.from("import_batches").select("*").eq("account_id", accountId).order("import_date", { ascending: false });
    if (data) setBatches(data);
  };

  const handleArchive = async (id: string) => {
    await supabase.from("accounts").update({ is_active: false }).eq("id", id);
    toast("Account archived"); fetchAccounts();
  };

  const handleUnarchive = async (id: string) => {
    await supabase.from("accounts").update({ is_active: true }).eq("id", id);
    toast("Account restored"); fetchAccounts();
  };

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`Permanently delete "${name}"?\n\nThis will also delete ALL transactions imported to this account. This cannot be undone.`)) return;
    await supabase.from("accounts").delete().eq("id", id);
    toast("Account deleted"); fetchAccounts();
  };

  // ─── Gallery View ─────────────────────────────
  const renderGallery = () => {
    const active = accounts.filter((a) => a.is_active);
    const archived = accounts.filter((a) => !a.is_active);
    return (
      <div>
        <div className="flex justify-between items-end mb-8">
          <h2 className="font-sans font-extrabold text-[32px] text-sq-black uppercase tracking-tight">Accounts</h2>
          <Button onClick={() => setView({ mode: "create" })}><Plus className="w-4 h-4" />Add Account</Button>
        </div>

        {active.length === 0 ? (
          <Card className="text-center py-16 mb-8">
            <p className="font-sans text-sq-gray-600 text-[15px] mb-4">No active accounts. Create your first account to get started.</p>
            <Button onClick={() => setView({ mode: "create" })}><Plus className="w-4 h-4" />Add Account</Button>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-12">
            {active.map((acct) => (
              <AccountCard
                key={acct.id}
                account={acct}
                onHistory={() => { loadHistory(acct.id); setView({ mode: "history", accountId: acct.id, accountName: acct.name }); }}
                onCCBilling={() => { loadCCBilling(acct.id); setView({ mode: "cc_billing", accountId: acct.id, accountName: acct.name }); }}
                onArchive={() => handleArchive(acct.id)}
              />
            ))}
          </div>
        )}

        {archived.length > 0 && (
          <div>
            <h3 className="font-sans font-extrabold text-[18px] text-sq-gray-600 uppercase tracking-tight mb-4 flex items-center gap-2">
              <Archive className="w-4 h-4" />Archived ({archived.length})
            </h3>
            <div className="border border-sq-gray-100">
              {archived.map((acct) => (
                <div key={acct.id} className="flex items-center justify-between px-6 py-4 border-b border-sq-gray-100 last:border-b-0">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 border border-sq-gray-400 flex items-center justify-center opacity-40">
                      {accountTypeIcon[acct.type] || accountTypeIcon.other}
                    </div>
                    <div>
                      <div className="font-sans font-semibold text-[15px] text-sq-gray-600">{acct.name}</div>
                      <div className="font-sans text-[11px] uppercase tracking-widest text-sq-gray-400">{acct.type.replace("_", " ")} · {acct.currency}</div>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => handleUnarchive(acct.id)} className="flex items-center gap-1.5 px-3 py-1.5 border border-sq-gray-400 font-sans text-[11px] uppercase font-semibold text-sq-gray-600 hover:border-sq-black hover:text-sq-black transition-colors">
                      <ArchiveRestore className="w-3 h-3" />Restore
                    </button>
                    <button onClick={() => handleDelete(acct.id, acct.name)} className="flex items-center gap-1.5 px-3 py-1.5 border border-sq-gray-400 font-sans text-[11px] uppercase font-semibold text-sq-gray-600 hover:border-sq-red hover:text-sq-red transition-colors">
                      <Trash2 className="w-3 h-3" />Delete
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  };

  // ─── Create Account View ──────────────────────
  const renderCreate = () => (
    <div className="max-w-2xl">
      <h2 className="font-sans font-extrabold text-[32px] text-sq-black uppercase tracking-tight mb-8">Create Account</h2>
      <Card>
        <Input label="Account Name" type="text" placeholder="e.g. Chase Personal Checking" value={newName} onChange={(e) => setNewName(e.target.value)} />
        <div className="mb-6">
          <label className="block font-sans font-semibold text-[12px] uppercase tracking-widest text-sq-black mb-2">Account Type</label>
          <div className="flex gap-4">
            {(["checking", "credit_card", "shared", "savings", "other"] as AccountType[]).map((t) => (
              <button key={t} onClick={() => setNewType(t)} className={`flex-1 border-2 border-sq-black py-3 font-sans font-semibold text-[13px] uppercase tracking-wider transition-colors ${newType === t ? "bg-sq-black text-sq-white" : "text-sq-black hover:bg-sq-gray-100"}`}>
                {t.replace("_", " ")}
              </button>
            ))}
          </div>
        </div>
        <Select label="Currency" value={newCurrency} onChange={(e) => setNewCurrency(e.target.value)} options={[{ value: "USD", label: "USD ($)" }, { value: "EUR", label: "EUR (€)" }, { value: "GBP", label: "GBP (£)" }, { value: "SEK", label: "SEK (kr)" }]} />
        <div className="flex justify-end gap-4 mt-2">
          <Button variant="ghost" onClick={() => setView({ mode: "gallery" })}>Cancel</Button>
          <Button onClick={handleCreate} disabled={creating || !newName.trim()}>{creating ? "Creating…" : "Create Account"}</Button>
        </div>
      </Card>
    </div>
  );

  // ─── Import History View ──────────────────────
  const renderHistory = () => {
    if (view.mode !== "history") return null;
    return (
      <div>
        <div className="flex items-center gap-4 mb-8">
          <button onClick={() => setView({ mode: "gallery" })} className="text-sq-gray-600 hover:text-sq-black"><ArrowLeft className="w-5 h-5" /></button>
          <h2 className="font-sans font-extrabold text-[32px] text-sq-black uppercase tracking-tight">Import History: {view.accountName}</h2>
        </div>
        <div className="border border-sq-black">
          <div className="grid grid-cols-12 gap-4 px-6 py-3 bg-sq-gray-100 border-b border-sq-black">
            <div className="col-span-4 sq-label-muted">Filename</div>
            <div className="col-span-3 text-right sq-label-muted">Date</div>
            <div className="col-span-2 text-right sq-label-muted">Rows</div>
            <div className="col-span-3 text-right sq-label-muted">Actions</div>
          </div>
          {batches.length === 0 ? (
            <div className="px-6 py-8 text-center text-sq-gray-600 font-sans text-[14px]">No imports yet for this account.</div>
          ) : batches.map((batch) => (
            <div key={batch.id} className="grid grid-cols-12 gap-4 px-6 py-4 border-b border-sq-gray-100 items-center">
              <div className="col-span-4 font-mono text-[14px] text-sq-black">{batch.file_name}</div>
              <div className="col-span-3 text-right font-sans text-[14px] text-sq-gray-600">{formatDate(batch.import_date)}</div>
              <div className="col-span-2 text-right font-mono text-[14px] text-sq-gray-600">
                {batch.imported_count}
                {batch.skipped_count > 0 && <span className="text-sq-red ml-3">({batch.skipped_count} skipped)</span>}
              </div>
              <div className="col-span-3 text-right flex justify-end">
                <button onClick={async () => { if (confirm("Delete this import batch and all its transactions? This cannot be undone.")) { await supabase.from("import_batches").delete().eq("id", batch.id); loadHistory(view.accountId); } }} className="text-sq-red hover:underline font-sans text-[12px] uppercase font-semibold">Delete</button>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  };

  // ─── CC Billing View ──────────────────────────
  const renderCCBilling = () => {
    if (view.mode !== "cc_billing") return null;
    const currency = accounts.find((a) => a.id === view.accountId)?.currency || "SEK";

    return (
      <div>
        <div className="flex items-center gap-4 mb-2">
          <button onClick={() => setView({ mode: "gallery" })} className="text-sq-gray-600 hover:text-sq-black"><ArrowLeft className="w-5 h-5" /></button>
          <h2 className="font-sans font-extrabold text-[32px] text-sq-black uppercase tracking-tight">CC Billing: {view.accountName}</h2>
        </div>
        <p className="font-sans text-[13px] text-sq-gray-600 mb-8 ml-9">
          Each row is a calendar-month billing period. The system auto-detects matching payments from your checking account and shows the amount delta. Confirm correct matches or pick a different payment.
        </p>

        {ccLoading ? (
          <div className="text-center py-16 text-sq-gray-600 font-sans text-[14px]">Loading billing data…</div>
        ) : billingPeriods.length === 0 ? (
          <Card className="text-center py-12">
            <p className="font-sans text-sq-gray-600 text-[14px]">No transactions found for this account. Import a CSV first.</p>
          </Card>
        ) : (
          <>
            {/* Legend */}
            <div className="flex gap-6 mb-4 font-sans text-[12px] text-sq-gray-600">
              <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-green-500" />Confirmed</span>
              <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-sq-blue" />Auto-suggested</span>
              <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-sq-gray-400" />Unmatched</span>
            </div>

            <div className="border-2 border-sq-black">
              {/* Header */}
              <div className="grid grid-cols-12 gap-4 px-6 py-3 bg-sq-gray-100 border-b border-sq-black">
                <div className="col-span-2 sq-label-muted">Period</div>
                <div className="col-span-1 text-right sq-label-muted">Charges</div>
                <div className="col-span-2 text-right sq-label-muted">CC Total</div>
                <div className="col-span-3 sq-label-muted">Matched Payment</div>
                <div className="col-span-1 text-right sq-label-muted">Payment</div>
                <div className="col-span-1 text-right sq-label-muted">Delta</div>
                <div className="col-span-2 text-right sq-label-muted">Actions</div>
              </div>

              {billingPeriods.map((period) => {
                const isSaving = saving === period.month;
                const isPicking = pickingForMonth === period.month;
                const bill = period.confirmedBill;
                const suggested = period.suggestedPayment;
                const paymentTx = bill?.payment_transaction as Transaction | undefined;

                const statusDot = bill
                  ? "bg-green-500"
                  : suggested
                  ? "bg-sq-blue"
                  : "bg-sq-gray-400";

                const displayPayment = paymentTx || suggested?.tx;
                const delta = paymentTx
                  ? Math.abs(Math.abs(paymentTx.amount) - period.totalCharges)
                  : suggested?.delta ?? null;
                const deltaIsLarge = delta !== null && delta > 50;

                return (
                  <div key={period.month} className="border-b border-sq-gray-100 last:border-0">
                    <div className="grid grid-cols-12 gap-4 px-6 py-4 items-center">
                      {/* Period */}
                      <div className="col-span-2 flex items-center gap-2">
                        <span className={`w-2 h-2 rounded-full flex-shrink-0 ${statusDot}`} />
                        <div>
                          <div className="font-sans font-semibold text-[14px] text-sq-black">
                            {new Date(period.startDate + "T12:00:00").toLocaleString("default", { month: "short", year: "numeric" })}
                          </div>
                          <div className="font-mono text-[10px] text-sq-gray-400">
                            {formatDate(period.startDate)} – {formatDate(period.endDate)}
                          </div>
                        </div>
                      </div>

                      {/* Charge count */}
                      <div className="col-span-1 text-right font-mono text-[13px] text-sq-gray-600">
                        {period.chargeCount}
                      </div>

                      {/* CC total */}
                      <div className="col-span-2 text-right font-mono text-[14px] font-bold text-sq-red">
                        {formatCurrency(period.totalCharges, currency)}
                      </div>

                      {/* Matched payment description + date */}
                      <div className="col-span-3 min-w-0">
                        {displayPayment ? (
                          <div>
                            <div className="font-sans text-[13px] text-sq-black truncate">{displayPayment.description}</div>
                            <div className="font-mono text-[11px] text-sq-gray-400">{formatDate(displayPayment.date)}</div>
                          </div>
                        ) : (
                          <span className="font-sans text-[12px] text-sq-gray-400 italic">No match found</span>
                        )}
                      </div>

                      {/* Payment amount */}
                      <div className="col-span-1 text-right font-mono text-[13px] text-sq-black">
                        {displayPayment ? formatCurrency(Math.abs(displayPayment.amount), currency) : "—"}
                      </div>

                      {/* Delta */}
                      <div className={cn("col-span-1 text-right font-mono text-[13px]", deltaIsLarge ? "text-sq-red font-bold" : "text-sq-gray-600")}>
                        {delta !== null ? (
                          <span className="flex items-center justify-end gap-1">
                            {deltaIsLarge && <AlertTriangle className="w-3 h-3" />}
                            {formatCurrency(delta, currency)}
                          </span>
                        ) : "—"}
                      </div>

                      {/* Actions */}
                      <div className="col-span-2 flex justify-end gap-1.5">
                        {bill ? (
                          <>
                            <button
                              onClick={() => setPickingForMonth(isPicking ? null : period.month)}
                              disabled={isSaving}
                              className="px-2 py-1 border border-sq-gray-400 font-sans text-[11px] uppercase font-semibold text-sq-gray-600 hover:border-sq-black hover:text-sq-black transition-colors disabled:opacity-40 flex items-center gap-1"
                              title="Change payment"
                            >
                              <Link className="w-3 h-3" />Edit
                            </button>
                            <button
                              onClick={() => handleUnlink(period)}
                              disabled={isSaving}
                              className="px-2 py-1 border border-sq-gray-400 font-sans text-[11px] uppercase font-semibold text-sq-gray-600 hover:border-sq-red hover:text-sq-red transition-colors disabled:opacity-40 flex items-center gap-1"
                              title="Remove mapping"
                            >
                              <Unlink className="w-3 h-3" />
                            </button>
                          </>
                        ) : suggested ? (
                          <>
                            <button
                              onClick={() => handleConfirm(period, suggested.tx.id)}
                              disabled={isSaving}
                              className="px-2 py-1 bg-sq-black text-sq-white font-sans text-[11px] uppercase font-semibold hover:opacity-80 transition-opacity disabled:opacity-40 flex items-center gap-1"
                            >
                              <Check className="w-3 h-3" />{isSaving ? "…" : "Confirm"}
                            </button>
                            <button
                              onClick={() => setPickingForMonth(isPicking ? null : period.month)}
                              disabled={isSaving}
                              className="px-2 py-1 border border-sq-gray-400 font-sans text-[11px] uppercase font-semibold text-sq-gray-600 hover:border-sq-black hover:text-sq-black transition-colors disabled:opacity-40"
                            >
                              Pick
                            </button>
                          </>
                        ) : (
                          <button
                            onClick={() => setPickingForMonth(isPicking ? null : period.month)}
                            className="px-2 py-1 border border-sq-gray-400 font-sans text-[11px] uppercase font-semibold text-sq-gray-600 hover:border-sq-black hover:text-sq-black transition-colors flex items-center gap-1"
                          >
                            <Link className="w-3 h-3" />Match
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Payment picker panel */}
                    {isPicking && (
                      <PaymentPicker
                        period={period}
                        candidates={paymentCandidates}
                        currency={currency}
                        onPick={(txId) => handleConfirm(period, txId)}
                        onClose={() => setPickingForMonth(null)}
                      />
                    )}
                  </div>
                );
              })}
            </div>

            {paymentCandidates.length === 0 && (
              <p className="mt-4 font-sans text-[12px] text-sq-gray-400">
                No CC payment transactions detected in your checking accounts. Transactions must contain keywords like "SEB KORT", "KORTBETALNING", or "KREDITKORT" to be auto-matched.
              </p>
            )}
          </>
        )}
      </div>
    );
  };

  return (
    <PageShell userName={userName}>
      {view.mode === "gallery" && renderGallery()}
      {view.mode === "create" && renderCreate()}
      {view.mode === "history" && renderHistory()}
      {view.mode === "cc_billing" && renderCCBilling()}
    </PageShell>
  );
}

// ─── Payment Picker Panel ─────────────────────
function PaymentPicker({
  period,
  candidates,
  currency,
  onPick,
  onClose,
}: {
  period: BillingPeriod;
  candidates: Transaction[];
  currency: string;
  onPick: (txId: string) => void;
  onClose: () => void;
}) {
  // Show all candidates sorted by date proximity to billing period end, best amount match first
  const sorted = [...candidates]
    .map((tx) => ({
      tx,
      daysAfter: daysBetween(period.endDate, tx.date),
      delta: Math.abs(Math.abs(tx.amount) - period.totalCharges),
    }))
    .filter(({ daysAfter }) => daysAfter >= -30 && daysAfter <= 90)
    .sort((a, b) => a.delta - b.delta || Math.abs(a.daysAfter) - Math.abs(b.daysAfter));

  return (
    <div className="bg-sq-gray-100 border-t border-sq-black px-6 py-4">
      <div className="flex justify-between items-center mb-3">
        <span className="font-sans font-semibold text-[12px] uppercase tracking-wider text-sq-black">
          Select payment for {new Date(period.startDate + "T12:00:00").toLocaleString("default", { month: "long", year: "numeric" })} — CC total {formatCurrency(period.totalCharges, currency)}
        </span>
        <button onClick={onClose} className="text-sq-gray-400 hover:text-sq-black"><X className="w-4 h-4" /></button>
      </div>
      {sorted.length === 0 ? (
        <p className="font-sans text-[13px] text-sq-gray-600">No candidate payments found within ±30–90 days of this period.</p>
      ) : (
        <div className="space-y-1 max-h-64 overflow-y-auto">
          {sorted.map(({ tx, daysAfter, delta }) => (
            <button
              key={tx.id}
              onClick={() => onPick(tx.id)}
              className="w-full flex items-center justify-between px-4 py-2.5 bg-white border border-sq-gray-100 hover:border-sq-black transition-colors text-left"
            >
              <div>
                <div className="font-sans text-[13px] text-sq-black">{tx.description}</div>
                <div className="font-mono text-[11px] text-sq-gray-400">
                  {formatDate(tx.date)}
                  <span className="ml-2 text-sq-gray-400">({daysAfter >= 0 ? `+${daysAfter}` : daysAfter} days from period end)</span>
                </div>
              </div>
              <div className="text-right ml-4 flex-shrink-0">
                <div className="font-mono text-[14px] font-bold text-sq-black">{formatCurrency(Math.abs(tx.amount), currency)}</div>
                <div className={cn("font-mono text-[11px]", delta > 50 ? "text-sq-red" : "text-green-600")}>
                  Δ {formatCurrency(delta, currency)}
                </div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Account Card Component ───────────────────
function AccountCard({
  account,
  onHistory,
  onCCBilling,
  onArchive,
}: {
  account: Account;
  onHistory: () => void;
  onCCBilling: () => void;
  onArchive: () => void;
}) {
  const icon = accountTypeIcon[account.type] || accountTypeIcon.other;
  const isCC = account.type === "credit_card";

  return (
    <Card hover>
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 border-2 border-sq-black flex items-center justify-center bg-sq-gray-100">{icon}</div>
          <div>
            <div className="font-sans font-bold text-[18px] text-sq-black">{account.name}</div>
            <div className="font-sans text-[11px] uppercase tracking-widest text-sq-gray-600">{account.type.replace("_", " ")}</div>
          </div>
        </div>
        <button onClick={onArchive} title="Archive account" className="text-sq-gray-400 hover:text-sq-gray-600 transition-colors">
          <Archive className="w-4 h-4" />
        </button>
      </div>

      <div className="mb-4">
        <div className="sq-label-muted mb-1">Currency</div>
        <div className="font-mono text-[20px] font-bold text-sq-black">{account.currency}</div>
      </div>
      <div className="mb-6">
        <div className="sq-label-muted mb-1">Created</div>
        <div className="font-sans text-[14px] text-sq-black">{formatDate(account.created_at)}</div>
      </div>

      <div className="flex gap-2 pt-4 border-t border-sq-gray-100">
        <button onClick={onHistory} className="flex-1 border-2 border-sq-black py-2 font-sans text-[11px] uppercase font-semibold text-sq-black hover:bg-sq-black hover:text-sq-white transition-colors flex items-center justify-center gap-1">
          <History className="w-3 h-3" />History
        </button>
        {isCC && (
          <button onClick={onCCBilling} className="flex-1 border-2 border-sq-black py-2 font-sans text-[11px] uppercase font-semibold text-sq-black hover:bg-sq-black hover:text-sq-white transition-colors flex items-center justify-center gap-1">
            <CreditCard className="w-3 h-3" />CC Billing
          </button>
        )}
      </div>
    </Card>
  );
}

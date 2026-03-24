"use client";

export const dynamic = "force-dynamic";

import React, { useState, useEffect, useMemo } from "react";
import { CreditCard, ChevronDown, ChevronRight, Check, AlertTriangle, HelpCircle } from "lucide-react";
import { PageShell } from "@/components/layout/PageShell";
import { Button, Card } from "@/components/ui";
import { createClient } from "@/lib/supabase/client";
import { formatCurrency, formatDate } from "@/lib/utils";
import type { Account, Transaction, CreditCardBill } from "@/lib/types";

// ─── Types ───────────────────────────────────────────────────────────────────

interface BillingPeriod {
  /** Unique key: the payment transaction id, or "unmatched-{startDate}" */
  key: string;
  startDate: string;   // first CC transaction date in this period
  endDate: string;     // last CC transaction date in this period
  ccTransactions: Transaction[];
  ccTotal: number;
  /** Best auto-suggested payment from checking, sorted by amount closeness */
  suggestedPayment: Transaction | null;
  /** All payment candidates from checking accounts, sorted by amount closeness */
  candidates: Transaction[];
  /** Confirmed/saved payment (from credit_card_bills record) */
  confirmedPayment: Transaction | null;
  bill: CreditCardBill | null;
  diffPct: number | null;  // % difference between confirmed payment and CC total
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmt(d: string) {
  return new Date(d).toLocaleDateString("en-SE", { day: "numeric", month: "short", year: "numeric" });
}

/**
 * Group CC transactions into billing periods using CONFIRMED payment dates as boundaries.
 * For unconfirmed periods, group by calendar month as a reasonable default.
 */
function buildBillingPeriods(
  ccTxs: Transaction[],
  confirmedPayments: Transaction[],       // payments already saved in credit_card_bills
  allCheckingTxs: Transaction[],          // all transactions from non-CC accounts
  bills: CreditCardBill[]
): BillingPeriod[] {
  const sorted = [...ccTxs].sort((a, b) => a.date.localeCompare(b.date));
  if (sorted.length === 0) return [];

  const periods: BillingPeriod[] = [];

  // ── 1. Build confirmed periods ──────────────────────────────────────────
  const sortedPayments = [...confirmedPayments].sort((a, b) => a.date.localeCompare(b.date));

  for (let i = 0; i < sortedPayments.length; i++) {
    const pay = sortedPayments[i];
    const prevPayDate = i === 0 ? "" : sortedPayments[i - 1].date;

    const periodTxs = sorted.filter((t) => {
      if (t.date > pay.date) return false;
      if (prevPayDate && t.date <= prevPayDate) return false;
      return true;
    });
    if (periodTxs.length === 0) continue;

    const ccTotal = periodTxs.reduce((s, t) => s + Math.abs(t.amount), 0);
    const bill = bills.find((b) => b.payment_transaction_id === pay.id) || null;
    const diff = bill ? Math.abs(Math.abs(pay.amount) - ccTotal) / (ccTotal || 1) * 100 : null;

    periods.push({
      key: pay.id,
      startDate: periodTxs[0].date,
      endDate: periodTxs[periodTxs.length - 1].date,
      ccTransactions: periodTxs,
      ccTotal,
      suggestedPayment: pay,
      candidates: [],
      confirmedPayment: pay,
      bill,
      diffPct: diff,
    });
  }

  // ── 2. Remaining CC transactions not covered by any confirmed payment ───
  const lastPayDate = sortedPayments.length > 0 ? sortedPayments[sortedPayments.length - 1].date : "";
  const unmatched = sorted.filter((t) => !lastPayDate || t.date > lastPayDate);

  if (unmatched.length > 0) {
    // Group unmatched by calendar month
    const monthMap = new Map<string, Transaction[]>();
    for (const tx of unmatched) {
      const key = tx.date.slice(0, 7);
      if (!monthMap.has(key)) monthMap.set(key, []);
      monthMap.get(key)!.push(tx);
    }

    for (const [month, txs] of Array.from(monthMap.entries()).sort(([a], [b]) => b.localeCompare(a))) {
      const sortedMonth = [...txs].sort((a, b) => a.date.localeCompare(b.date));
      const ccTotal = sortedMonth.reduce((s, t) => s + Math.abs(t.amount), 0);
      const endDate = sortedMonth[sortedMonth.length - 1].date;

      // Find candidates: expenses from checking that come on or after the last CC transaction
      // amount > 0 because expenses (money leaving checking) are stored as positive
      const candidates = allCheckingTxs
        .filter((tx) => tx.amount > 0 && tx.date >= endDate)
        .sort((a, b) => Math.abs(Math.abs(a.amount) - ccTotal) - Math.abs(Math.abs(b.amount) - ccTotal));

      periods.push({
        key: `unmatched-${month}`,
        startDate: sortedMonth[0].date,
        endDate,
        ccTransactions: sortedMonth,
        ccTotal,
        suggestedPayment: candidates[0] || null,
        candidates,
        confirmedPayment: null,
        bill: null,
        diffPct: null,
      });
    }
  }

  return periods.sort((a, b) => b.endDate.localeCompare(a.endDate));
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function CcBillsPage() {
  const supabase = createClient();
  const [userName, setUserName] = useState("");
  const [displayCurrency, setDisplayCurrency] = useState("SEK");
  const [ccAccounts, setCcAccounts] = useState<Account[]>([]);
  const [checkingAccounts, setCheckingAccounts] = useState<Account[]>([]);
  const [allTxs, setAllTxs] = useState<Transaction[]>([]);
  const [bills, setBills] = useState<CreditCardBill[]>([]);
  const [loading, setLoading] = useState(true);

  const [expandedAccount, setExpandedAccount] = useState<string | null>(null);
  const [expandedPeriod, setExpandedPeriod] = useState<string | null>(null);
  const [confirmingPeriod, setConfirmingPeriod] = useState<string | null>(null);
  const [selectedPaymentId, setSelectedPaymentId] = useState("");
  const [saving, setSaving] = useState(false);

  const loadData = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      setUserName(user.user_metadata?.name || user.email || "");
      const { data: profile } = await supabase.from("profiles").select("default_currency").eq("id", user.id).single();
      if (profile?.default_currency) setDisplayCurrency(profile.default_currency);
    }

    const [{ data: accts }, { data: txData }, { data: billData }] = await Promise.all([
      supabase.from("accounts").select("*").eq("is_active", true),
      supabase.from("transactions").select("*").order("date"),
      supabase.from("credit_card_bills").select("*"),
    ]);

    if (accts) {
      setCcAccounts(accts.filter((a: Account) => a.type === "credit_card"));
      setCheckingAccounts(accts.filter((a: Account) => a.type !== "credit_card"));
    }
    if (txData) setAllTxs(txData as Transaction[]);
    if (billData) setBills(billData as CreditCardBill[]);
    setLoading(false);
  };

  useEffect(() => { loadData(); }, [supabase]);

  const periodsByAccount = useMemo(() => {
    const result = new Map<string, BillingPeriod[]>();
    for (const cc of ccAccounts) {
      const ccTxs = allTxs.filter((t) => t.account_id === cc.id);
      const ccBills = bills.filter((b) => b.credit_card_account_id === cc.id);
      const confirmedPayments = allTxs.filter((t) =>
        ccBills.some((b) => b.payment_transaction_id === t.id)
      );
      const checkingTxs = allTxs.filter((t) =>
        checkingAccounts.some((a) => a.id === t.account_id)
      );
      result.set(cc.id, buildBillingPeriods(ccTxs, confirmedPayments, checkingTxs, ccBills));
    }
    return result;
  }, [ccAccounts, allTxs, bills, checkingAccounts]);

  const handleConfirmPayment = async (ccAccountId: string, period: BillingPeriod, paymentId: string) => {
    setSaving(true);
    const paymentTx = allTxs.find((t) => t.id === paymentId);
    if (!paymentTx) { setSaving(false); return; }

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setSaving(false); return; }

    if (period.bill) {
      await supabase.from("credit_card_bills").update({
        payment_transaction_id: paymentId,
        total_amount: period.ccTotal,
        statement_start_date: period.startDate,
        statement_end_date: period.endDate,
      }).eq("id", period.bill.id);
    } else {
      await supabase.from("credit_card_bills").insert({
        user_id: user.id,
        credit_card_account_id: ccAccountId,
        payment_transaction_id: paymentId,
        total_amount: period.ccTotal,
        statement_start_date: period.startDate,
        statement_end_date: period.endDate,
        is_exploded: false,
        import_batch_id: null,
      });
    }

    // Tag the payment transaction as cc_payment so it's excluded from spending totals
    await supabase.from("transactions")
      .update({ transaction_type: "cc_payment" })
      .eq("id", paymentId);

    setConfirmingPeriod(null);
    setSelectedPaymentId("");
    setSaving(false);
    await loadData();
  };

  const handleUnlink = async (period: BillingPeriod) => {
    if (!period.bill) return;
    // Restore the payment transaction to expense type
    if (period.confirmedPayment) {
      await supabase.from("transactions")
        .update({ transaction_type: "expense" })
        .eq("id", period.confirmedPayment.id);
    }
    await supabase.from("credit_card_bills").delete().eq("id", period.bill.id);
    await loadData();
  };

  if (loading) {
    return (
      <PageShell userName={userName}>
        <div className="text-center py-16 text-sq-gray-600 font-sans text-[14px]">Loading…</div>
      </PageShell>
    );
  }

  return (
    <PageShell userName={userName}>
      <div className="mb-8">
        <h1 className="font-sans font-extrabold text-[32px] text-sq-black uppercase tracking-tight mb-2">
          CC Reconciliation
        </h1>
        <div className="border-l-4 border-sq-blue pl-4 py-1 bg-sq-gray-100">
          <p className="font-sans text-[13px] text-sq-gray-600 leading-relaxed">
            For each CC billing period, confirm which checking account payment it corresponds to.
            Once confirmed, that payment is excluded from your spending totals — only the individual CC transactions are counted.
          </p>
        </div>
      </div>

      {ccAccounts.length === 0 ? (
        <Card className="text-center py-16">
          <CreditCard className="w-10 h-10 text-sq-gray-400 mx-auto mb-3" />
          <p className="font-sans text-sq-gray-600 text-[15px]">No credit card accounts. Add one in Accounts.</p>
        </Card>
      ) : (
        <div className="space-y-6">
          {ccAccounts.map((cc) => {
            const periods = periodsByAccount.get(cc.id) || [];
            const confirmed = periods.filter((p) => p.confirmedPayment).length;
            const needsAttention = periods.filter((p) => !p.confirmedPayment || (p.diffPct !== null && p.diffPct > 5)).length;
            const isOpen = expandedAccount === cc.id;

            return (
              <div key={cc.id} className="border-2 border-sq-black">
                {/* Account header */}
                <button
                  onClick={() => setExpandedAccount(isOpen ? null : cc.id)}
                  className="w-full flex items-center justify-between px-6 py-4 hover:bg-sq-gray-100 transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <CreditCard className="w-5 h-5" />
                    <span className="font-sans font-bold text-[16px] text-sq-black">{cc.name}</span>
                    <span className="font-sans text-[12px] text-sq-gray-600">
                      {confirmed}/{periods.length} confirmed
                    </span>
                    {needsAttention > 0 && (
                      <span className="flex items-center gap-1 font-sans text-[11px] text-amber-600 font-semibold">
                        <AlertTriangle className="w-3 h-3" />
                        {needsAttention} need{needsAttention === 1 ? "s" : ""} attention
                      </span>
                    )}
                  </div>
                  {isOpen ? <ChevronDown className="w-5 h-5" /> : <ChevronRight className="w-5 h-5" />}
                </button>

                {isOpen && (
                  <div className="border-t-2 border-sq-black">
                    {/* Table header */}
                    <div className="grid grid-cols-12 gap-4 px-6 py-2 bg-sq-gray-100 border-b border-sq-black">
                      <div className="col-span-3 sq-label-muted">CC Period</div>
                      <div className="col-span-1 text-right sq-label-muted">Txns</div>
                      <div className="col-span-2 text-right sq-label-muted">CC Total</div>
                      <div className="col-span-4 sq-label-muted">Checking Payment</div>
                      <div className="col-span-2 sq-label-muted text-right">Status</div>
                    </div>

                    {periods.map((period) => {
                      const periodKey = `${cc.id}:${period.key}`;
                      const isExpanded = expandedPeriod === periodKey;
                      const isConfirming = confirmingPeriod === periodKey;

                      const statusIcon = period.confirmedPayment
                        ? period.diffPct !== null && period.diffPct > 5
                          ? <span className="text-sq-red text-[11px] font-semibold flex items-center gap-1"><AlertTriangle className="w-3 h-3" />{period.diffPct.toFixed(1)}% diff</span>
                          : <span className="text-sq-green text-[11px] font-semibold flex items-center gap-1"><Check className="w-3 h-3" />Confirmed</span>
                        : <span className="text-amber-600 text-[11px] font-semibold flex items-center gap-1"><HelpCircle className="w-3 h-3" />Needs payment</span>;

                      return (
                        <div key={period.key} className="border-b border-sq-gray-100 last:border-0">
                          <div className="grid grid-cols-12 gap-4 px-6 py-3 items-center">
                            {/* Period dates */}
                            <div
                              className="col-span-3 flex items-center gap-1.5 cursor-pointer"
                              onClick={() => setExpandedPeriod(isExpanded ? null : periodKey)}
                            >
                              {isExpanded
                                ? <ChevronDown className="w-3.5 h-3.5 text-sq-gray-600 flex-shrink-0" />
                                : <ChevronRight className="w-3.5 h-3.5 text-sq-gray-600 flex-shrink-0" />}
                              <span className="font-sans text-[13px] font-semibold text-sq-black">
                                {fmt(period.startDate)} – {fmt(period.endDate)}
                              </span>
                            </div>

                            {/* Txn count */}
                            <div className="col-span-1 text-right font-mono text-[13px] text-sq-gray-600">
                              {period.ccTransactions.length}
                            </div>

                            {/* CC total */}
                            <div className="col-span-2 text-right font-mono text-[14px] font-bold text-sq-red">
                              {formatCurrency(period.ccTotal, displayCurrency)}
                            </div>

                            {/* Payment info */}
                            <div className="col-span-4 font-sans text-[13px]">
                              {period.confirmedPayment ? (
                                <div>
                                  <div className="text-sq-black font-semibold">
                                    {formatDate(period.confirmedPayment.date)} · {formatCurrency(Math.abs(period.confirmedPayment.amount), displayCurrency)}
                                  </div>
                                  <div className="text-sq-gray-400 text-[11px] truncate">{period.confirmedPayment.description}</div>
                                </div>
                              ) : period.suggestedPayment ? (
                                <div>
                                  <div className="text-sq-gray-600 italic text-[12px]">Suggested:</div>
                                  <div className="text-sq-black">
                                    {formatDate(period.suggestedPayment.date)} · {formatCurrency(Math.abs(period.suggestedPayment.amount), displayCurrency)}
                                  </div>
                                  <div className="text-sq-gray-400 text-[11px] truncate">{period.suggestedPayment.description}</div>
                                </div>
                              ) : (
                                <span className="text-sq-gray-400 italic">No matching payment found</span>
                              )}
                            </div>

                            {/* Status + actions */}
                            <div className="col-span-2 flex flex-col items-end gap-1">
                              {statusIcon}
                              <div className="flex gap-1">
                                {!period.confirmedPayment && period.suggestedPayment && (
                                  <button
                                    onClick={() => handleConfirmPayment(cc.id, period, period.suggestedPayment!.id)}
                                    disabled={saving}
                                    className="px-2 py-1 bg-sq-black text-sq-white font-sans text-[10px] uppercase font-semibold hover:opacity-80 transition-opacity disabled:opacity-40"
                                  >
                                    Confirm
                                  </button>
                                )}
                                <button
                                  onClick={() => {
                                    setConfirmingPeriod(isConfirming ? null : periodKey);
                                    setSelectedPaymentId(period.confirmedPayment?.id || period.suggestedPayment?.id || "");
                                  }}
                                  className="px-2 py-1 border border-sq-gray-400 font-sans text-[10px] uppercase font-semibold text-sq-gray-600 hover:border-sq-black hover:text-sq-black transition-colors"
                                >
                                  {period.confirmedPayment ? "Change" : "Select"}
                                </button>
                                {period.confirmedPayment && (
                                  <button
                                    onClick={() => handleUnlink(period)}
                                    className="px-2 py-1 border border-sq-gray-400 font-sans text-[10px] uppercase font-semibold text-sq-red hover:border-sq-red transition-colors"
                                  >
                                    Unlink
                                  </button>
                                )}
                              </div>
                            </div>
                          </div>

                          {/* Manual payment picker */}
                          {isConfirming && (
                            <div className="bg-sq-gray-100 border-t border-sq-gray-100 px-8 py-4">
                              <div className="sq-label-muted mb-2">
                                CC total: <strong>{formatCurrency(period.ccTotal, displayCurrency)}</strong>
                                <span className="ml-2 text-sq-gray-400">· select the payment from your checking account</span>
                              </div>
                              {period.candidates.length === 0 ? (
                                <p className="font-sans text-[13px] text-sq-gray-600">
                                  No expenses found in checking accounts on or after {formatDate(period.endDate)}.
                                </p>
                              ) : (
                                <div className="flex items-center gap-3">
                                  <select
                                    value={selectedPaymentId}
                                    onChange={(e) => setSelectedPaymentId(e.target.value)}
                                    className="flex-1 border-2 border-sq-black px-3 py-2 font-sans text-[13px] outline-none bg-white"
                                  >
                                    <option value="">Select payment…</option>
                                    {period.candidates.map((tx) => {
                                      const acct = checkingAccounts.find((a) => a.id === tx.account_id)?.name || "";
                                      const diff = Math.abs(Math.abs(tx.amount) - period.ccTotal);
                                      const pct = period.ccTotal > 0 ? (diff / period.ccTotal * 100).toFixed(1) : "?";
                                      const tag = diff < 1 ? "✓ exact match" : `${pct}% diff`;
                                      return (
                                        <option key={tx.id} value={tx.id}>
                                          {formatDate(tx.date)} · {tx.description} · {formatCurrency(Math.abs(tx.amount), displayCurrency)} [{tag}] ({acct})
                                        </option>
                                      );
                                    })}
                                  </select>
                                  <Button
                                    size="sm"
                                    onClick={() => selectedPaymentId && handleConfirmPayment(cc.id, period, selectedPaymentId)}
                                    disabled={!selectedPaymentId || saving}
                                  >
                                    {saving ? "Saving…" : "Confirm"}
                                  </Button>
                                  <Button size="sm" variant="ghost" onClick={() => setConfirmingPeriod(null)}>
                                    Cancel
                                  </Button>
                                </div>
                              )}
                            </div>
                          )}

                          {/* Expanded CC transaction list */}
                          {isExpanded && (
                            <div className="border-t border-sq-gray-100">
                              {period.ccTransactions.map((tx) => (
                                <div key={tx.id} className="grid grid-cols-12 gap-4 px-10 py-2 border-b border-sq-gray-100 items-center last:border-0">
                                  <div className="col-span-2 font-mono text-[12px] text-sq-gray-600">{formatDate(tx.date)}</div>
                                  <div className="col-span-7 font-sans text-[13px] text-sq-black">{tx.description}</div>
                                  <div className="col-span-3 text-right font-mono text-[13px] font-bold text-sq-red">
                                    {formatCurrency(Math.abs(tx.amount), tx.currency || displayCurrency)}
                                  </div>
                                </div>
                              ))}
                              <div className="grid grid-cols-12 gap-4 px-10 py-2 bg-sq-gray-100 border-t border-sq-black">
                                <div className="col-span-9 font-sans text-[11px] uppercase font-bold tracking-wider text-sq-gray-600">
                                  Total ({period.ccTransactions.length} transactions)
                                </div>
                                <div className="col-span-3 text-right font-mono text-[13px] font-bold text-sq-red">
                                  {formatCurrency(period.ccTotal, displayCurrency)}
                                </div>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </PageShell>
  );
}

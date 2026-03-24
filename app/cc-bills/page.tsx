"use client";

export const dynamic = "force-dynamic";

import React, { useState, useEffect } from "react";
import { CreditCard, Link2, Zap, ChevronDown, ChevronRight } from "lucide-react";
import { PageShell } from "@/components/layout/PageShell";
import { Button, Card } from "@/components/ui";
import { createClient } from "@/lib/supabase/client";
import { formatCurrency, formatDate, cn } from "@/lib/utils";
import type { Account, Transaction, CreditCardBill } from "@/lib/types";

interface Period {
  key: string;
  label: string;
  startDate: string;
  endDate: string;
  transactions: Transaction[];
  total: number;
  bill: CreditCardBill | null;
  payment: Transaction | null;
}

/**
 * Build billing periods for a CC account by anchoring on linked payment transactions.
 * Each payment defines a period boundary: CC transactions that occurred BEFORE this payment
 * but AFTER the previous payment belong to this billing period.
 * Remaining CC transactions (not yet covered by any payment) form an "unlinked" group.
 */
function buildPeriods(
  ccTxs: Transaction[],
  linkedPayments: Transaction[], // sorted ascending by date
  existingBills: CreditCardBill[]
): Period[] {
  const sorted = [...ccTxs].sort((a, b) => a.date.localeCompare(b.date));
  if (sorted.length === 0) return [];

  const periods: Period[] = [];

  if (linkedPayments.length === 0) {
    // No payments linked yet — show all CC transactions as one unlinked group
    const total = sorted.reduce((s, t) => s + Math.abs(t.amount), 0);
    periods.push({
      key: "unlinked",
      label: `${formatDateShort(sorted[0].date)} – ${formatDateShort(sorted[sorted.length - 1].date)}`,
      startDate: sorted[0].date,
      endDate: sorted[sorted.length - 1].date,
      transactions: sorted,
      total,
      bill: null,
      payment: null,
    });
    return periods;
  }

  // Sort payments oldest-first
  const payments = [...linkedPayments].sort((a, b) => a.date.localeCompare(b.date));

  // Build one period per payment
  for (let i = 0; i < payments.length; i++) {
    const pay = payments[i];
    const prevPayDate = i === 0 ? "" : payments[i - 1].date;

    // CC transactions that belong to this payment: date <= payment date and date > prev payment date
    const periodTxs = sorted.filter((t) => {
      if (t.date > pay.date) return false;
      if (prevPayDate && t.date <= prevPayDate) return false;
      return true;
    });

    if (periodTxs.length === 0) continue;

    const startDate = periodTxs[0].date;
    const endDate = periodTxs[periodTxs.length - 1].date;
    const total = periodTxs.reduce((s, t) => s + Math.abs(t.amount), 0);

    // Find the bill record associated with this payment
    const bill = existingBills.find((b) => b.payment_transaction_id === pay.id) || null;

    periods.push({
      key: pay.id,
      label: `${formatDateShort(startDate)} – ${formatDateShort(endDate)}`,
      startDate,
      endDate,
      transactions: periodTxs,
      total,
      bill,
      payment: pay,
    });
  }

  // Remaining CC transactions after the last payment
  const lastPayDate = payments[payments.length - 1].date;
  const remaining = sorted.filter((t) => t.date > lastPayDate);
  if (remaining.length > 0) {
    const total = remaining.reduce((s, t) => s + Math.abs(t.amount), 0);
    periods.push({
      key: "current",
      label: `${formatDateShort(remaining[0].date)} – present`,
      startDate: remaining[0].date,
      endDate: remaining[remaining.length - 1].date,
      transactions: remaining,
      total,
      bill: null,
      payment: null,
    });
  }

  return periods.reverse(); // newest first
}

function formatDateShort(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("en-SE", { day: "numeric", month: "short", year: "numeric" });
}

export default function CcBillsPage() {
  const supabase = createClient();
  const [userName, setUserName] = useState("");
  const [displayCurrency, setDisplayCurrency] = useState("SEK");
  const [ccAccounts, setCcAccounts] = useState<Account[]>([]);
  const [mainAccounts, setMainAccounts] = useState<Account[]>([]);
  const [allTxs, setAllTxs] = useState<Transaction[]>([]);
  const [bills, setBills] = useState<CreditCardBill[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedAccount, setExpandedAccount] = useState<string | null>(null);
  const [expandedPeriod, setExpandedPeriod] = useState<string | null>(null);

  // Linking state
  const [linkingPeriod, setLinkingPeriod] = useState<string | null>(null);
  const [candidatePayments, setCandidatePayments] = useState<Transaction[]>([]);
  const [selectedPaymentId, setSelectedPaymentId] = useState("");
  const [linking, setLinking] = useState(false);
  const [exploding, setExploding] = useState<string | null>(null);

  const loadData = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      setUserName(user.user_metadata?.name || user.email || "");
      const { data: profile } = await supabase.from("profiles").select("default_currency").eq("id", user.id).single();
      if (profile?.default_currency) setDisplayCurrency(profile.default_currency);
    }

    const { data: accts } = await supabase.from("accounts").select("*").eq("is_active", true);
    if (!accts) { setLoading(false); return; }

    const ccAccts = accts.filter((a: Account) => a.type === "credit_card");
    const mainAccts = accts.filter((a: Account) => a.type !== "credit_card");
    setCcAccounts(ccAccts);
    setMainAccounts(mainAccts);

    const { data: txs } = await supabase
      .from("transactions")
      .select("*")
      .order("date", { ascending: false });

    if (txs) setAllTxs(txs as Transaction[]);

    const { data: billData } = await supabase.from("credit_card_bills").select("*");
    if (billData) setBills(billData);


    setLoading(false);
  };

  useEffect(() => { loadData(); }, [supabase]);

  const periodsForAccount = (accountId: string): Period[] => {
    // All CC transactions for this account (all amounts — purchases + refunds)
    const ccTxs = allTxs.filter((t) => t.account_id === accountId);

    // All known payment transactions linked to this CC account's bills
    const ccBills = bills.filter((b) => b.credit_card_account_id === accountId);
    const linkedPayments: Transaction[] = [];
    for (const b of ccBills) {
      const payTx = allTxs.find((t) => t.id === b.payment_transaction_id);
      if (payTx) linkedPayments.push(payTx);
    }

    return buildPeriods(ccTxs, linkedPayments, ccBills);
  };

  const handleStartLink = (accountId: string, period: Period) => {
    const key = `${accountId}:${period.key}`;
    setLinkingPeriod(key);
    setSelectedPaymentId("");

    // Candidates: outgoing transactions from main accounts
    // that come AFTER the last CC transaction in this period
    // Sorted by closest amount match to the CC total
    const candidates = allTxs.filter((tx) => {
      if (mainAccounts.every((a) => a.id !== tx.account_id)) return false;
      if (tx.date < period.endDate) return false; // payment must come after last CC tx
      if (tx.amount > 0) return false; // only outgoing (negative = money leaving checking)
      if (tx.transaction_type === "cc_payment") return true; // already tagged
      // Also include any large outgoing transactions that could be CC payments
      return true;
    });

    candidates.sort((a, b) => {
      const diffA = Math.abs(Math.abs(a.amount) - period.total);
      const diffB = Math.abs(Math.abs(b.amount) - period.total);
      return diffA - diffB;
    });

    setCandidatePayments(candidates);
  };

  const handleLinkPayment = async (accountId: string, period: Period) => {
    if (!selectedPaymentId) return;
    setLinking(true);

    const paymentTx = candidatePayments.find((t) => t.id === selectedPaymentId);
    if (!paymentTx) { setLinking(false); return; }

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setLinking(false); return; }

    const billPayload = {
      payment_transaction_id: selectedPaymentId,
      total_amount: period.total,
      statement_start_date: period.startDate,
      statement_end_date: period.endDate,
      import_batch_id: null,
    };

    // Check if a bill already exists for this payment
    const existingBill = bills.find(
      (b) => b.credit_card_account_id === accountId && b.payment_transaction_id === selectedPaymentId
    ) || (period.bill || null);

    if (existingBill) {
      await supabase.from("credit_card_bills").update(billPayload).eq("id", existingBill.id);
    } else {
      await supabase.from("credit_card_bills").insert({
        user_id: user.id,
        credit_card_account_id: accountId,
        is_exploded: false,
        ...billPayload,
      });
    }

    await supabase.from("transactions")
      .update({ transaction_type: "cc_payment" })
      .eq("id", selectedPaymentId);

    setLinkingPeriod(null);
    setLinking(false);
    await loadData();
  };

  const handleExplode = async (bill: CreditCardBill, payment: Transaction) => {
    setExploding(bill.id);
    await supabase.from("transactions").delete().eq("id", payment.id);
    await supabase.from("credit_card_bills").update({ is_exploded: true }).eq("id", bill.id);
    setExploding(null);
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
      <div className="flex justify-between items-end mb-8">
        <h1 className="font-sans font-extrabold text-[32px] text-sq-black uppercase tracking-tight">
          Credit Card Bills
        </h1>
        <p className="font-sans text-[13px] text-sq-gray-600">
          Link a payment to anchor the billing period, then explode to replace with individual charges
        </p>
      </div>

      {ccAccounts.length === 0 ? (
        <Card className="text-center py-16">
          <p className="font-sans text-sq-gray-600 text-[15px]">
            No credit card accounts found. Add one in Accounts.
          </p>
        </Card>
      ) : (
        <div className="space-y-6">
          {ccAccounts.map((ccAcct) => {
            const periods = periodsForAccount(ccAcct.id);
            const isOpen = expandedAccount === ccAcct.id;
            const linkedCount = periods.filter((p) => p.payment).length;

            return (
              <div key={ccAcct.id} className="border-2 border-sq-black">
                <button
                  onClick={() => setExpandedAccount(isOpen ? null : ccAcct.id)}
                  className="w-full flex items-center justify-between px-6 py-4 hover:bg-sq-gray-100 transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <CreditCard className="w-5 h-5 text-sq-black" />
                    <span className="font-sans font-bold text-[16px] text-sq-black">{ccAcct.name}</span>
                    <span className="font-sans text-[12px] text-sq-gray-600">
                      {periods.length} period{periods.length !== 1 ? "s" : ""} · {linkedCount} linked
                    </span>
                  </div>
                  {isOpen ? <ChevronDown className="w-5 h-5" /> : <ChevronRight className="w-5 h-5" />}
                </button>

                {isOpen && (
                  <div className="border-t border-sq-black">
                    <div className="grid grid-cols-12 gap-4 px-6 py-2 bg-sq-gray-100 border-b border-sq-black">
                      <div className="col-span-3 sq-label-muted">Period (actual CC dates)</div>
                      <div className="col-span-1 sq-label-muted text-right">Txns</div>
                      <div className="col-span-2 sq-label-muted text-right">CC Total</div>
                      <div className="col-span-4 sq-label-muted">Payment from checking</div>
                      <div className="col-span-2 sq-label-muted text-right">Actions</div>
                    </div>

                    {periods.length === 0 && (
                      <div className="px-6 py-8 text-center font-sans text-[14px] text-sq-gray-600">
                        No transactions found for this account.
                      </div>
                    )}

                    {periods.map((period) => {
                      const periodKey = `${ccAcct.id}:${period.key}`;
                      const isExpandedPeriod = expandedPeriod === periodKey;
                      const isLinking = linkingPeriod === periodKey;
                      const isExploded = period.bill?.is_exploded ?? false;

                      const amountDiff = period.payment
                        ? Math.abs(Math.abs(period.payment.amount) - period.total)
                        : null;
                      const amountPct = amountDiff !== null && period.total > 0
                        ? (amountDiff / period.total) * 100
                        : null;
                      const matchQuality = amountPct === null ? null
                        : amountPct < 1 ? "good"
                        : amountPct < 5 ? "ok"
                        : "poor";

                      return (
                        <div key={period.key} className={cn(isExploded && "opacity-50")}>
                          <div className="grid grid-cols-12 gap-4 px-6 py-3 border-b border-sq-gray-100 items-center">
                            <div
                              className="col-span-3 flex items-center gap-1.5 cursor-pointer"
                              onClick={() => setExpandedPeriod(isExpandedPeriod ? null : periodKey)}
                            >
                              {isExpandedPeriod
                                ? <ChevronDown className="w-3.5 h-3.5 text-sq-gray-600 flex-shrink-0" />
                                : <ChevronRight className="w-3.5 h-3.5 text-sq-gray-600 flex-shrink-0" />
                              }
                              <span className="font-sans text-[13px] font-semibold text-sq-black leading-tight">
                                {period.label}
                              </span>
                            </div>

                            <div className="col-span-1 text-right font-mono text-[13px] text-sq-gray-600">
                              {period.transactions.length}
                            </div>

                            <div className="col-span-2 text-right font-mono text-[14px] font-bold text-sq-red">
                              {formatCurrency(period.total, displayCurrency)}
                            </div>

                            <div className="col-span-4 font-sans text-[13px]">
                              {isExploded ? (
                                <span className="text-sq-green font-semibold">✓ Exploded</span>
                              ) : period.payment ? (
                                <div className="flex items-center gap-2 flex-wrap">
                                  <span className="text-sq-black">
                                    {formatDate(period.payment.date)} · {formatCurrency(Math.abs(period.payment.amount), displayCurrency)}
                                  </span>
                                  {matchQuality === "good" && <span className="text-sq-green text-[11px] font-semibold">✓ exact</span>}
                                  {matchQuality === "ok" && <span className="text-amber-500 text-[11px]">~{amountPct?.toFixed(1)}% diff</span>}
                                  {matchQuality === "poor" && <span className="text-sq-red text-[11px] font-semibold">⚠ {amountPct?.toFixed(0)}% diff</span>}
                                </div>
                              ) : (
                                <span className="text-sq-gray-400 italic">Not linked</span>
                              )}
                            </div>

                            <div className="col-span-2 flex justify-end gap-2">
                              {!isExploded && (
                                <>
                                  <button
                                    onClick={() => isLinking ? setLinkingPeriod(null) : handleStartLink(ccAcct.id, period)}
                                    className="flex items-center gap-1 px-3 py-1.5 border border-sq-gray-400 font-sans text-[11px] uppercase font-semibold text-sq-gray-600 hover:border-sq-black hover:text-sq-black transition-colors"
                                  >
                                    <Link2 className="w-3 h-3" />
                                    {period.payment ? "Re-link" : "Link"}
                                  </button>
                                  {period.payment && period.bill && !isExploded && (
                                    <button
                                      onClick={() => handleExplode(period.bill!, period.payment!)}
                                      disabled={exploding === period.bill!.id}
                                      className="flex items-center gap-1 px-3 py-1.5 border border-sq-black font-sans text-[11px] uppercase font-semibold text-sq-black hover:bg-sq-black hover:text-sq-white transition-colors disabled:opacity-50"
                                    >
                                      <Zap className="w-3 h-3" />
                                      {exploding === period.bill!.id ? "…" : "Explode"}
                                    </button>
                                  )}
                                </>
                              )}
                            </div>
                          </div>

                          {/* Link payment UI */}
                          {isLinking && (
                            <div className="bg-sq-gray-100 border-b border-sq-black px-8 py-4">
                              <div className="sq-label-muted mb-1">
                                CC total: <strong>{formatCurrency(period.total, displayCurrency)}</strong>
                                <span className="ml-2 text-sq-gray-400">· candidates sorted by closest amount, must be on or after {formatDate(period.endDate)}</span>
                              </div>
                              {candidatePayments.length === 0 ? (
                                <p className="font-sans text-[13px] text-sq-gray-600 mt-2">
                                  No outgoing payments found in checking accounts after {formatDate(period.endDate)}.
                                </p>
                              ) : (
                                <div className="flex items-end gap-3 mt-2">
                                  <div className="flex-1">
                                    <select
                                      value={selectedPaymentId}
                                      onChange={(e) => setSelectedPaymentId(e.target.value)}
                                      className="w-full border-2 border-sq-black px-3 py-2 font-sans text-[13px] outline-none bg-white"
                                    >
                                      <option value="">Select payment…</option>
                                      {candidatePayments.map((tx) => {
                                        const acctName = mainAccounts.find((a) => a.id === tx.account_id)?.name || "";
                                        const diff = Math.abs(Math.abs(tx.amount) - period.total);
                                        const pct = period.total > 0 ? (diff / period.total * 100).toFixed(1) : "?";
                                        const tag = diff < 1 ? "✓ exact" : `${pct}% diff`;
                                        return (
                                          <option key={tx.id} value={tx.id}>
                                            {formatDate(tx.date)} · {tx.description} · {formatCurrency(Math.abs(tx.amount), displayCurrency)} [{tag}] ({acctName})
                                          </option>
                                        );
                                      })}
                                    </select>
                                  </div>
                                  <Button size="sm" onClick={() => handleLinkPayment(ccAcct.id, period)} disabled={!selectedPaymentId || linking}>
                                    {linking ? "Linking…" : "Confirm"}
                                  </Button>
                                  <Button size="sm" variant="ghost" onClick={() => setLinkingPeriod(null)}>
                                    Cancel
                                  </Button>
                                </div>
                              )}
                            </div>
                          )}

                          {/* Expanded transaction list */}
                          {isExpandedPeriod && (
                            <div className="border-b border-sq-black">
                              {period.transactions.map((tx) => (
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
                                  Total ({period.transactions.length} transactions)
                                </div>
                                <div className="col-span-3 text-right font-mono text-[13px] font-bold text-sq-red">
                                  {formatCurrency(period.total, displayCurrency)}
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

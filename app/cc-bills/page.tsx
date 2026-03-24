"use client";

export const dynamic = "force-dynamic";

import React, { useState, useEffect } from "react";
import { CreditCard, Link2, Zap, ChevronDown, ChevronRight } from "lucide-react";
import { PageShell } from "@/components/layout/PageShell";
import { Button, Card } from "@/components/ui";
import { createClient } from "@/lib/supabase/client";
import { formatCurrency, formatDate, cn } from "@/lib/utils";
import type { Account, Transaction, CreditCardBill, ImportBatch } from "@/lib/types";

interface Period {
  key: string;           // import_batch_id (or fallback key)
  batchId: string | null;
  label: string;         // e.g. "15 Nov – 14 Dec 2024"
  startDate: string;     // min transaction date in batch
  endDate: string;       // max transaction date in batch
  transactions: Transaction[];
  total: number;
  bill: CreditCardBill | null;
  payment: Transaction | null;
}

/** Group transactions by import_batch_id, falling back to calendar month for any without a batch. */
function groupByBatch(txs: Transaction[], batches: ImportBatch[]): Period[] {
  const batchMap = new Map<string, Transaction[]>();
  const noBatch: Transaction[] = [];

  for (const tx of txs) {
    if (tx.import_batch_id) {
      if (!batchMap.has(tx.import_batch_id)) batchMap.set(tx.import_batch_id, []);
      batchMap.get(tx.import_batch_id)!.push(tx);
    } else {
      noBatch.push(tx);
    }
  }

  const periods: Period[] = [];

  // Batch-grouped periods
  for (const [batchId, batchTxs] of Array.from(batchMap.entries())) {
    const sorted = [...batchTxs].sort((a, b) => a.date.localeCompare(b.date));
    const startDate = sorted[0].date;
    const endDate = sorted[sorted.length - 1].date;
    const batch = batches.find((b) => b.id === batchId);
    const label = batch
      ? `${formatDateShort(startDate)} – ${formatDateShort(endDate)}`
      : `${formatDateShort(startDate)} – ${formatDateShort(endDate)}`;
    periods.push({
      key: batchId,
      batchId,
      label,
      startDate,
      endDate,
      transactions: sorted,
      total: sorted.reduce((s, t) => s + Math.abs(t.amount), 0),
      bill: null,
      payment: null,
    });
  }

  // Fall-through: transactions without a batch_id, grouped by calendar month
  if (noBatch.length > 0) {
    const monthMap = new Map<string, Transaction[]>();
    for (const tx of noBatch) {
      const key = tx.date.slice(0, 7);
      if (!monthMap.has(key)) monthMap.set(key, []);
      monthMap.get(key)!.push(tx);
    }
    for (const [month, mTxs] of Array.from(monthMap.entries())) {
      const sorted = [...mTxs].sort((a, b) => a.date.localeCompare(b.date));
      periods.push({
        key: `month:${month}`,
        batchId: null,
        label: new Date(month + "-01").toLocaleDateString("en-US", { month: "long", year: "numeric" }),
        startDate: sorted[0].date,
        endDate: sorted[sorted.length - 1].date,
        transactions: sorted,
        total: sorted.reduce((s, t) => s + Math.abs(t.amount), 0),
        bill: null,
        payment: null,
      });
    }
  }

  return periods.sort((a, b) => b.endDate.localeCompare(a.endDate));
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
  const [txByAccount, setTxByAccount] = useState<Map<string, Transaction[]>>(new Map());
  const [batchesByAccount, setBatchesByAccount] = useState<Map<string, ImportBatch[]>>(new Map());
  const [bills, setBills] = useState<CreditCardBill[]>([]);
  const [paymentsByBill, setPaymentsByBill] = useState<Map<string, Transaction>>(new Map());
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

    // Load import batches for CC accounts
    const { data: batchData } = await supabase
      .from("import_batches")
      .select("*")
      .in("account_id", ccAccts.map((a: Account) => a.id));

    if (txs) {
      const txMap = new Map<string, Transaction[]>();
      for (const tx of txs as Transaction[]) {
        if (!txMap.has(tx.account_id)) txMap.set(tx.account_id, []);
        txMap.get(tx.account_id)!.push(tx);
      }
      setTxByAccount(txMap);
    }

    if (batchData) {
      const bMap = new Map<string, ImportBatch[]>();
      for (const b of batchData as ImportBatch[]) {
        if (!bMap.has(b.account_id)) bMap.set(b.account_id, []);
        bMap.get(b.account_id)!.push(b);
      }
      setBatchesByAccount(bMap);
    }

    const { data: billData } = await supabase.from("credit_card_bills").select("*");
    if (billData) setBills(billData);

    if (billData && txs) {
      const pmap = new Map<string, Transaction>();
      for (const bill of billData as CreditCardBill[]) {
        const payTx = (txs as Transaction[]).find((t) => t.id === bill.payment_transaction_id);
        if (payTx) pmap.set(bill.id, payTx);
      }
      setPaymentsByBill(pmap);
    }

    setLoading(false);
  };

  useEffect(() => { loadData(); }, [supabase]);

  const periodsForAccount = (accountId: string): Period[] => {
    const txs = (txByAccount.get(accountId) || []).filter((t) => t.amount > 0);
    const batches = batchesByAccount.get(accountId) || [];
    const periods = groupByBatch(txs, batches);

    return periods.map((p) => {
      // Match a bill: prefer batch_id match, fall back to date overlap
      const bill = bills.find((b) => {
        if (b.credit_card_account_id !== accountId) return false;
        if (p.batchId && b.import_batch_id === p.batchId) return true;
        // date overlap fallback
        return b.statement_start_date <= p.endDate && b.statement_end_date >= p.startDate;
      }) || null;
      const payment = bill ? (paymentsByBill.get(bill.id) || null) : null;
      return { ...p, bill, payment };
    });
  };

  const handleStartLink = async (accountId: string, period: Period) => {
    const key = `${accountId}:${period.key}`;
    setLinkingPeriod(key);
    setSelectedPaymentId("");

    // Search for payments AFTER the last transaction in the batch (bill always comes after last tx)
    // Window: last tx date to last tx date + 60 days
    const lastTxDate = new Date(period.endDate);
    const searchFrom = period.endDate; // payment can't be before last transaction
    const searchTo = new Date(lastTxDate);
    searchTo.setDate(searchTo.getDate() + 60);
    const searchToStr = searchTo.toISOString().slice(0, 10);

    const candidates: Transaction[] = [];
    for (const [acctId, txs] of Array.from(txByAccount.entries())) {
      const acct = mainAccounts.find((a) => a.id === acctId);
      if (!acct) continue;
      for (const tx of txs) {
        if (
          tx.date >= searchFrom &&
          tx.date <= searchToStr &&
          tx.amount < 0 // outgoing from main account
        ) {
          candidates.push(tx);
        }
      }
    }

    // Sort: closest amount match first
    const target = period.total;
    candidates.sort((a, b) => {
      const diffA = Math.abs(Math.abs(a.amount) - target);
      const diffB = Math.abs(Math.abs(b.amount) - target);
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
      import_batch_id: period.batchId,
    };

    if (period.bill) {
      await supabase.from("credit_card_bills").update(billPayload).eq("id", period.bill.id);
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
          Each row = one imported statement file. Link to the matching payment, then explode.
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
                      {periods.length} statement{periods.length !== 1 ? "s" : ""} · {periods.filter((p) => p.bill && !p.bill.is_exploded).length} linked
                    </span>
                  </div>
                  {isOpen ? <ChevronDown className="w-5 h-5" /> : <ChevronRight className="w-5 h-5" />}
                </button>

                {isOpen && (
                  <div className="border-t border-sq-black">
                    <div className="grid grid-cols-12 gap-4 px-6 py-2 bg-sq-gray-100 border-b border-sq-black">
                      <div className="col-span-3 sq-label-muted">Statement Period</div>
                      <div className="col-span-1 sq-label-muted text-right">Txns</div>
                      <div className="col-span-2 sq-label-muted text-right">Bill Total</div>
                      <div className="col-span-4 sq-label-muted">Payment Matched</div>
                      <div className="col-span-2 sq-label-muted text-right">Actions</div>
                    </div>

                    {periods.map((period) => {
                      const periodKey = `${ccAcct.id}:${period.key}`;
                      const isExpandedPeriod = expandedPeriod === periodKey;
                      const isLinking = linkingPeriod === periodKey;
                      const isExploded = period.bill?.is_exploded ?? false;

                      // Amount match quality indicator
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
                            {/* Period label */}
                            <div
                              className="col-span-3 flex items-center gap-1.5 cursor-pointer"
                              onClick={() => setExpandedPeriod(isExpandedPeriod ? null : periodKey)}
                            >
                              {isExpandedPeriod
                                ? <ChevronDown className="w-3.5 h-3.5 text-sq-gray-600 flex-shrink-0" />
                                : <ChevronRight className="w-3.5 h-3.5 text-sq-gray-600 flex-shrink-0" />
                              }
                              <div>
                                <div className="font-sans text-[13px] font-semibold text-sq-black">
                                  {period.label}
                                </div>
                                {!period.batchId && (
                                  <div className="font-sans text-[10px] text-sq-gray-400 italic">no batch</div>
                                )}
                              </div>
                            </div>

                            {/* Count */}
                            <div className="col-span-1 text-right font-mono text-[13px] text-sq-gray-600">
                              {period.transactions.length}
                            </div>

                            {/* Total */}
                            <div className="col-span-2 text-right font-mono text-[14px] font-bold text-sq-red">
                              {formatCurrency(period.total, displayCurrency)}
                            </div>

                            {/* Payment status */}
                            <div className="col-span-4 font-sans text-[13px]">
                              {isExploded ? (
                                <span className="text-sq-green font-semibold">✓ Exploded</span>
                              ) : period.payment ? (
                                <div>
                                  <span className="text-sq-black">
                                    {formatDate(period.payment.date)} · {formatCurrency(Math.abs(period.payment.amount), displayCurrency)}
                                  </span>
                                  {matchQuality === "poor" && (
                                    <span className="ml-2 text-sq-red text-[11px] font-semibold">
                                      ⚠ {amountPct?.toFixed(0)}% diff
                                    </span>
                                  )}
                                  {matchQuality === "ok" && (
                                    <span className="ml-2 text-amber-500 text-[11px]">
                                      ~{amountPct?.toFixed(1)}% diff
                                    </span>
                                  )}
                                  {matchQuality === "good" && (
                                    <span className="ml-2 text-sq-green text-[11px]">✓ match</span>
                                  )}
                                </div>
                              ) : (
                                <span className="text-sq-gray-400 italic">No payment linked</span>
                              )}
                            </div>

                            {/* Actions */}
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
                                  {period.payment && period.bill && (
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
                                Bill total: <strong>{formatCurrency(period.total, displayCurrency)}</strong>
                                <span className="ml-2 text-sq-gray-400">— candidates sorted by closest amount match, after {formatDate(period.endDate)}</span>
                              </div>
                              {candidatePayments.length === 0 ? (
                                <p className="font-sans text-[13px] text-sq-gray-600 mt-2">
                                  No outgoing payments found in main accounts after {formatDate(period.endDate)}.
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
                                        const matchTag = diff < 1 ? "✓ exact" : `${pct}% diff`;
                                        return (
                                          <option key={tx.id} value={tx.id}>
                                            {formatDate(tx.date)} · {tx.description} · {formatCurrency(Math.abs(tx.amount), displayCurrency)} [{matchTag}] ({acctName})
                                          </option>
                                        );
                                      })}
                                    </select>
                                  </div>
                                  <Button
                                    size="sm"
                                    onClick={() => handleLinkPayment(ccAcct.id, period)}
                                    disabled={!selectedPaymentId || linking}
                                  >
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
                                <div
                                  key={tx.id}
                                  className="grid grid-cols-12 gap-4 px-10 py-2 border-b border-sq-gray-100 items-center last:border-0"
                                >
                                  <div className="col-span-2 font-mono text-[12px] text-sq-gray-600">
                                    {formatDate(tx.date)}
                                  </div>
                                  <div className="col-span-7 font-sans text-[13px] text-sq-black">
                                    {tx.description}
                                  </div>
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

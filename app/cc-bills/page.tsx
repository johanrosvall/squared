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
  key: string; // "YYYY-MM"
  label: string;
  transactions: Transaction[];
  total: number;
  bill: CreditCardBill | null;
  payment: Transaction | null;
}

function groupByMonth(txs: Transaction[]): Period[] {
  const map = new Map<string, Transaction[]>();
  for (const tx of txs) {
    const key = tx.date.slice(0, 7); // "YYYY-MM"
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(tx);
  }
  return Array.from(map.entries())
    .map(([key, txs]) => ({
      key,
      label: new Date(key + "-01").toLocaleDateString("en-US", { month: "long", year: "numeric" }),
      transactions: txs.sort((a, b) => a.date.localeCompare(b.date)),
      total: txs.reduce((s, t) => s + Math.abs(t.amount), 0),
      bill: null,
      payment: null,
    }))
    .sort((a, b) => b.key.localeCompare(a.key));
}

export default function CcBillsPage() {
  const supabase = createClient();
  const [userName, setUserName] = useState("");
  const [displayCurrency, setDisplayCurrency] = useState("SEK");
  const [ccAccounts, setCcAccounts] = useState<Account[]>([]);
  const [mainAccounts, setMainAccounts] = useState<Account[]>([]);
  const [txByAccount, setTxByAccount] = useState<Map<string, Transaction[]>>(new Map());
  const [bills, setBills] = useState<CreditCardBill[]>([]);
  const [paymentsByBill, setPaymentsByBill] = useState<Map<string, Transaction>>(new Map());
  const [loading, setLoading] = useState(true);
  const [expandedAccount, setExpandedAccount] = useState<string | null>(null);
  const [expandedPeriod, setExpandedPeriod] = useState<string | null>(null);

  // Linking state
  const [linkingPeriod, setLinkingPeriod] = useState<string | null>(null); // "accountId:YYYY-MM"
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
    if (accts) {
      setCcAccounts(accts.filter((a: Account) => a.type === "credit_card"));
      setMainAccounts(accts.filter((a: Account) => a.type !== "credit_card"));
    }

    const { data: txs } = await supabase
      .from("transactions")
      .select("*")
      .order("date", { ascending: false });

    if (txs) {
      const map = new Map<string, Transaction[]>();
      for (const tx of txs as Transaction[]) {
        if (!map.has(tx.account_id)) map.set(tx.account_id, []);
        map.get(tx.account_id)!.push(tx);
      }
      setTxByAccount(map);
    }

    const { data: billData } = await supabase.from("credit_card_bills").select("*");
    if (billData) setBills(billData);

    // Build payment lookup: bill.id → payment transaction
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
    const txs = (txByAccount.get(accountId) || []).filter((t) => t.amount > 0); // expenses only
    const periods = groupByMonth(txs);
    return periods.map((p) => {
      const bill = bills.find(
        (b) =>
          b.credit_card_account_id === accountId &&
          b.statement_start_date <= p.key + "-31" &&
          b.statement_end_date >= p.key + "-01"
      ) || null;
      const payment = bill ? (paymentsByBill.get(bill.id) || null) : null;
      return { ...p, bill, payment };
    });
  };

  const handleStartLink = async (accountId: string, period: Period) => {
    const key = `${accountId}:${period.key}`;
    setLinkingPeriod(key);
    setSelectedPaymentId("");

    // Find candidate payments from main accounts around the period date (+/- 45 days)
    const periodDate = new Date(period.key + "-28");
    const from = new Date(periodDate);
    from.setDate(from.getDate() - 20);
    const to = new Date(periodDate);
    to.setDate(to.getDate() + 45);

    const candidates: Transaction[] = [];
    for (const [acctId, txs] of txByAccount) {
      const acct = mainAccounts.find((a) => a.id === acctId);
      if (!acct) continue;
      for (const tx of txs) {
        if (tx.date >= from.toISOString().slice(0, 10) &&
            tx.date <= to.toISOString().slice(0, 10) &&
            tx.amount < 0) { // negative = money leaving main account = payment
          candidates.push(tx);
        }
      }
    }
    setCandidatePayments(candidates.sort((a, b) => b.date.localeCompare(a.date)));
  };

  const handleLinkPayment = async (accountId: string, period: Period) => {
    if (!selectedPaymentId) return;
    setLinking(true);

    const paymentTx = candidatePayments.find((t) => t.id === selectedPaymentId);
    if (!paymentTx) { setLinking(false); return; }

    // Create credit_card_bill record
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setLinking(false); return; }

    const startDate = `${period.key}-01`;
    const endDate = `${period.key}-31`;

    if (period.bill) {
      // Update existing
      await supabase.from("credit_card_bills").update({
        payment_transaction_id: selectedPaymentId,
        total_amount: period.total,
        statement_start_date: startDate,
        statement_end_date: endDate,
      }).eq("id", period.bill.id);
    } else {
      // Create new
      await supabase.from("credit_card_bills").insert({
        user_id: user.id,
        payment_transaction_id: selectedPaymentId,
        credit_card_account_id: accountId,
        statement_start_date: startDate,
        statement_end_date: endDate,
        total_amount: period.total,
        is_exploded: false,
      });
    }

    // Mark the payment transaction as cc_payment type
    await supabase.from("transactions")
      .update({ transaction_type: "cc_payment" })
      .eq("id", selectedPaymentId);

    setLinkingPeriod(null);
    setLinking(false);
    await loadData();
  };

  const handleExplode = async (bill: CreditCardBill, payment: Transaction) => {
    const key = bill.id;
    setExploding(key);

    // Delete the payment transaction from the main account
    await supabase.from("transactions").delete().eq("id", payment.id);

    // Mark the bill as exploded
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
          Link payments to billing periods, then explode to replace with individual charges
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
                {/* Account header */}
                <button
                  onClick={() => setExpandedAccount(isOpen ? null : ccAcct.id)}
                  className="w-full flex items-center justify-between px-6 py-4 hover:bg-sq-gray-100 transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <CreditCard className="w-5 h-5 text-sq-black" />
                    <span className="font-sans font-bold text-[16px] text-sq-black">{ccAcct.name}</span>
                    <span className="font-sans text-[12px] text-sq-gray-600">
                      {periods.length} periods · {periods.filter((p) => p.bill && !p.bill.is_exploded).length} linked
                    </span>
                  </div>
                  {isOpen ? <ChevronDown className="w-5 h-5" /> : <ChevronRight className="w-5 h-5" />}
                </button>

                {isOpen && (
                  <div className="border-t border-sq-black">
                    {/* Period list header */}
                    <div className="grid grid-cols-12 gap-4 px-6 py-2 bg-sq-gray-100 border-b border-sq-black">
                      <div className="col-span-2 sq-label-muted">Period</div>
                      <div className="col-span-1 sq-label-muted text-right">Txns</div>
                      <div className="col-span-2 sq-label-muted text-right">Total</div>
                      <div className="col-span-4 sq-label-muted">Payment</div>
                      <div className="col-span-3 sq-label-muted text-right">Actions</div>
                    </div>

                    {periods.map((period) => {
                      const periodKey = `${ccAcct.id}:${period.key}`;
                      const isExpandedPeriod = expandedPeriod === periodKey;
                      const isLinking = linkingPeriod === periodKey;
                      const isExploded = period.bill?.is_exploded ?? false;

                      return (
                        <div key={period.key} className={cn(isExploded && "opacity-50")}>
                          <div className="grid grid-cols-12 gap-4 px-6 py-3 border-b border-sq-gray-100 items-center">
                            {/* Period label */}
                            <div
                              className="col-span-2 flex items-center gap-1.5 cursor-pointer"
                              onClick={() => setExpandedPeriod(isExpandedPeriod ? null : periodKey)}
                            >
                              {isExpandedPeriod
                                ? <ChevronDown className="w-3.5 h-3.5 text-sq-gray-600" />
                                : <ChevronRight className="w-3.5 h-3.5 text-sq-gray-600" />
                              }
                              <span className="font-sans text-[13px] font-semibold text-sq-black">
                                {period.label}
                              </span>
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
                                <span className="text-sq-black">
                                  {formatDate(period.payment.date)} · {formatCurrency(Math.abs(period.payment.amount), displayCurrency)}
                                </span>
                              ) : (
                                <span className="text-sq-gray-400 italic">No payment linked</span>
                              )}
                            </div>

                            {/* Actions */}
                            <div className="col-span-3 flex justify-end gap-2">
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
                              <div className="sq-label-muted mb-3">
                                Select the payment from your main account for {period.label}
                              </div>
                              {candidatePayments.length === 0 ? (
                                <p className="font-sans text-[13px] text-sq-gray-600">
                                  No outgoing payments found from main accounts around this period.
                                </p>
                              ) : (
                                <div className="flex items-end gap-3">
                                  <div className="flex-1">
                                    <select
                                      value={selectedPaymentId}
                                      onChange={(e) => setSelectedPaymentId(e.target.value)}
                                      className="w-full border-2 border-sq-black px-3 py-2 font-sans text-[13px] outline-none bg-white"
                                    >
                                      <option value="">Select payment…</option>
                                      {candidatePayments.map((tx) => {
                                        const acctName = mainAccounts.find((a) => a.id === tx.account_id)?.name || "";
                                        return (
                                          <option key={tx.id} value={tx.id}>
                                            {formatDate(tx.date)} · {tx.description} · {formatCurrency(Math.abs(tx.amount), displayCurrency)} ({acctName})
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

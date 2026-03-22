"use client";

export const dynamic = "force-dynamic";

import React, { useState, useEffect, useMemo } from "react";
import Link from "next/link";
import {
  TrendingDown,
  TrendingUp,
  List,
  ArrowRight,
  Upload,
  RefreshCw,
} from "lucide-react";
import { PageShell } from "@/components/layout/PageShell";
import { Card, Button } from "@/components/ui";
import { createClient } from "@/lib/supabase/client";
import { formatCurrency, formatDate, pct, cn } from "@/lib/utils";
import { buildRateMap, convert } from "@/lib/currency";
import type { Transaction, Category, Account } from "@/lib/types";

type Period = "30d" | "month" | "3m" | "year";

const PERIOD_LABELS: Record<Period, string> = {
  "30d": "Last 30 Days",
  month: "This Month",
  "3m": "Last 3 Months",
  year: "This Year",
};

function getDateRange(period: Period): { from: string; to: string } {
  const now = new Date();
  const to = now.toISOString().slice(0, 10);
  let from: Date;
  if (period === "30d") {
    from = new Date(now);
    from.setDate(from.getDate() - 29);
  } else if (period === "month") {
    from = new Date(now.getFullYear(), now.getMonth(), 1);
  } else if (period === "3m") {
    from = new Date(now.getFullYear(), now.getMonth() - 2, 1);
  } else {
    from = new Date(now.getFullYear(), 0, 1);
  }
  return { from: from.toISOString().slice(0, 10), to };
}

export default function DashboardPage() {
  const supabase = createClient();
  const [userName, setUserName] = useState("");
  const [displayCurrency, setDisplayCurrency] = useState("");
  const [rateMap, setRateMap] = useState(new Map<string, number>());
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [period, setPeriod] = useState<Period>("30d");
  const [loadingTx, setLoadingTx] = useState(true);
  const [convertingRates, setConvertingRates] = useState(false);

  // Load user + profile currency once
  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        setUserName(user.user_metadata?.name || user.email || "");
        const { data: profile } = await supabase
          .from("profiles")
          .select("default_currency")
          .eq("id", user.id)
          .single();
        setDisplayCurrency(profile?.default_currency || "SEK");
      } else {
        setDisplayCurrency("SEK");
      }
    })();
  }, [supabase]);

  // Load transactions whenever period or currency changes (currency must be set first)
  useEffect(() => {
    if (!displayCurrency) return;
    const { from, to } = getDateRange(period);
    setLoadingTx(true);
    setRateMap(new Map());

    (async () => {
      const [{ data: txs }, { data: accts }] = await Promise.all([
        supabase
          .from("transactions")
          .select("*, category:categories(*), account:accounts!account_id(*)")
          .gte("date", from)
          .lte("date", to)
          .order("date", { ascending: false }),
        supabase.from("accounts").select("*").eq("is_active", true),
      ]);

      if (txs) setTransactions(txs);
      if (accts) setAccounts(accts);
      setLoadingTx(false);

      // FX conversion in background
      if (txs) {
        const foreign = txs.filter((t) => t.currency && t.currency !== displayCurrency);
        if (foreign.length > 0) {
          setConvertingRates(true);
          const rm = await buildRateMap(txs, displayCurrency);
          setRateMap(rm);
          setConvertingRates(false);
        }
      }
    })();
  }, [supabase, period, displayCurrency]);

  const cvt = (t: Transaction) =>
    convert(t.amount, t.currency, t.date, displayCurrency, rateMap);

  const expenses = useMemo(
    () => transactions.filter((t) => t.amount > 0 && t.transaction_type === "expense"),
    [transactions]
  );
  const incomes = useMemo(
    () => transactions.filter((t) => t.amount < 0 || t.transaction_type === "income"),
    [transactions]
  );

  const totalSpending = useMemo(() => expenses.reduce((s, t) => s + cvt(t), 0), [expenses, rateMap]);
  const totalIncome = useMemo(() => incomes.reduce((s, t) => s + Math.abs(cvt(t)), 0), [incomes, rateMap]);
  const netBalance = totalIncome - totalSpending;

  // Category breakdown
  const categoryList = useMemo(() => {
    const map = new Map<string, { name: string; color: string; total: number }>();
    for (const tx of expenses) {
      const cat = tx.category as Category | undefined;
      const key = cat?.id || "uncategorized";
      const entry = map.get(key) || {
        name: cat?.name || "Uncategorized",
        color: cat?.color || "#D4D4D4",
        total: 0,
      };
      entry.total += cvt(tx);
      map.set(key, entry);
    }
    return Array.from(map.values()).sort((a, b) => b.total - a.total);
  }, [expenses, rateMap]);

  // Format helper — shows "—" until currency is known
  const fmt = (n: number) => (displayCurrency ? formatCurrency(n, displayCurrency) : "—");

  const hasNoImports = !loadingTx && transactions.length === 0;

  return (
    <PageShell userName={userName}>
      {/* ─── Period selector ──────────────────── */}
      <div className="flex justify-between items-center mb-8">
        <h1 className="font-sans font-extrabold text-[32px] text-sq-black uppercase tracking-tight">
          Dashboard
        </h1>
        <div className="flex border-2 border-sq-black">
          {(Object.keys(PERIOD_LABELS) as Period[]).map((p) => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={cn(
                "px-4 py-2 font-sans font-semibold text-[11px] uppercase tracking-wider transition-colors border-r border-sq-black last:border-r-0",
                period === p
                  ? "bg-sq-black text-sq-white"
                  : "text-sq-gray-600 hover:text-sq-black hover:bg-sq-gray-100"
              )}
            >
              {PERIOD_LABELS[p]}
            </button>
          ))}
        </div>
      </div>

      {/* Loading / FX status */}
      {(loadingTx || convertingRates) && (
        <div className="flex items-center gap-3 mb-6 px-4 py-3 bg-sq-gray-100 border border-sq-gray-100 font-sans text-[13px] text-sq-gray-600">
          <RefreshCw className="w-3.5 h-3.5 animate-spin shrink-0" />
          {loadingTx
            ? "Fetching transactions…"
            : `Converting currencies for ${transactions.filter((t) => t.currency && t.currency !== displayCurrency).length} foreign transactions…`}
        </div>
      )}

      {/* CTA: no imports */}
      {hasNoImports && (
        <div className="border-2 border-sq-blue bg-blue-50 p-6 flex items-center justify-between mb-8">
          <div className="flex items-center gap-3">
            <Upload className="w-5 h-5 text-sq-blue" />
            <div>
              <div className="font-sans font-bold text-[14px] text-sq-black">Import new statements</div>
              <div className="font-sans text-[13px] text-sq-gray-600">
                Get started by importing your first CSV bank statement.
              </div>
            </div>
          </div>
          <Link href="/import">
            <Button>Import CSV <ArrowRight className="w-4 h-4" /></Button>
          </Link>
        </div>
      )}

      {/* ─── Summary row ──────────────────────── */}
      <div className="grid grid-cols-3 gap-6 mb-10">
        <Card>
          <div className="sq-label-muted mb-2 flex items-center gap-1.5">
            <TrendingDown className="w-3 h-3 text-sq-red" /> Spending
          </div>
          <div className="font-mono text-[36px] font-bold text-sq-red leading-none">
            {fmt(totalSpending)}
          </div>
          <div className="font-sans text-[12px] text-sq-gray-400 mt-2">
            {expenses.length} transactions
          </div>
        </Card>

        <Card>
          <div className="sq-label-muted mb-2 flex items-center gap-1.5">
            <TrendingUp className="w-3 h-3 text-sq-green" /> Income
          </div>
          <div className="font-mono text-[36px] font-bold text-sq-green leading-none">
            {fmt(totalIncome)}
          </div>
          <div className="font-sans text-[12px] text-sq-gray-400 mt-2">
            {incomes.length} transactions
          </div>
        </Card>

        <Card>
          <div className="sq-label-muted mb-2">Balance</div>
          <div
            className={cn(
              "font-mono text-[36px] font-bold leading-none",
              netBalance >= 0 ? "text-sq-green" : "text-sq-red"
            )}
          >
            {fmt(netBalance)}
          </div>
          <div className="font-sans text-[12px] text-sq-gray-400 mt-2">
            income minus spending
          </div>
        </Card>
      </div>

      {/* ─── Spending by Category ─────────────── */}
      {categoryList.length > 0 && (
        <div className="mb-12">
          <h2 className="font-sans font-extrabold text-[20px] text-sq-black uppercase tracking-tight mb-4 flex items-center gap-2">
            <TrendingDown className="w-5 h-5 text-sq-red" /> Spending by Category
          </h2>

          {/* Top 3 chips */}
          <div className="grid grid-cols-3 gap-4 mb-4">
            {categoryList.slice(0, 3).map((cat) => (
              <Card key={cat.name}>
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-3 h-3 rounded-full" style={{ backgroundColor: cat.color }} />
                  <span className="sq-label-muted">{cat.name}</span>
                </div>
                <div className="font-mono text-[24px] font-bold text-sq-black">{fmt(cat.total)}</div>
                <div className="font-sans text-[12px] text-sq-gray-600 mt-1">
                  {pct(cat.total, totalSpending)}
                </div>
              </Card>
            ))}
          </div>

          {/* Full category table */}
          <div className="border border-sq-black">
            <div className="grid grid-cols-12 gap-4 px-6 py-3 bg-sq-gray-100 border-b border-sq-black">
              <div className="col-span-6 sq-label-muted">Category</div>
              <div className="col-span-3 text-right sq-label-muted">Amount</div>
              <div className="col-span-3 text-right sq-label-muted">% of Total</div>
            </div>
            {categoryList.map((cat) => (
              <div
                key={cat.name}
                className="grid grid-cols-12 gap-4 px-6 py-3 border-b border-sq-gray-100 items-center"
              >
                <div className="col-span-6 flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full" style={{ backgroundColor: cat.color }} />
                  <span className="font-sans text-[14px] text-sq-black">{cat.name}</span>
                </div>
                <div className="col-span-3 text-right font-mono text-[14px] text-sq-black font-bold">
                  {fmt(cat.total)}
                </div>
                <div className="col-span-3 text-right font-mono text-[14px] text-sq-gray-600">
                  {pct(cat.total, totalSpending)}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ─── Recent Transactions ──────────────── */}
      <div>
        <div className="flex justify-between items-center mb-4">
          <h2 className="font-sans font-extrabold text-[20px] text-sq-black uppercase tracking-tight flex items-center gap-2">
            <List className="w-5 h-5 text-sq-black" /> Recent Transactions
          </h2>
          <Link
            href="/transactions"
            className="font-sans font-semibold text-[12px] uppercase tracking-wider text-sq-blue hover:underline flex items-center gap-1"
          >
            View All <ArrowRight className="w-3 h-3" />
          </Link>
        </div>
        <div className="border border-sq-black">
          <div className="grid grid-cols-12 gap-4 px-6 py-3 bg-sq-gray-100 border-b border-sq-black">
            <div className="col-span-2 sq-label-muted">Date</div>
            <div className="col-span-5 sq-label-muted">Description</div>
            <div className="col-span-3 sq-label-muted">Account</div>
            <div className="col-span-2 text-right sq-label-muted">Amount</div>
          </div>
          {transactions.length === 0 && !loadingTx ? (
            <div className="px-6 py-8 text-center text-sq-gray-600 font-sans text-[14px]">
              No transactions for this period.
            </div>
          ) : (
            transactions.slice(0, 10).map((tx) => {
              const account = tx.account as Account | undefined;
              return (
                <div
                  key={tx.id}
                  className="grid grid-cols-12 gap-4 px-6 py-3 border-b border-sq-gray-100 items-center"
                >
                  <div className="col-span-2 font-mono text-[13px] text-sq-gray-600">
                    {formatDate(tx.date)}
                  </div>
                  <div className="col-span-5 font-sans text-[14px] text-sq-black truncate">
                    {tx.description}
                  </div>
                  <div className="col-span-3 font-sans text-[12px] text-sq-gray-600 uppercase tracking-wider truncate">
                    {account?.name || "—"}
                  </div>
                  <div
                    className={cn(
                      "col-span-2 text-right font-mono text-[14px] font-bold",
                      tx.amount < 0 ? "text-sq-green" : "text-sq-black"
                    )}
                  >
                    {fmt(cvt(tx))}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </PageShell>
  );
}

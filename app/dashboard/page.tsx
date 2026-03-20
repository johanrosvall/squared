"use client";

export const dynamic = "force-dynamic";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import {
  TrendingDown,
  TrendingUp,
  List,
  AlertTriangle,
  ArrowRight,
  Upload,
  Scale,
  Copy,
} from "lucide-react";
import { PageShell } from "@/components/layout/PageShell";
import { Card, Button, Badge } from "@/components/ui";
import { createClient } from "@/lib/supabase/client";
import { formatCurrency, formatDate, pct, cn } from "@/lib/utils";
import type { Transaction, Category, Account } from "@/lib/types";

export default function DashboardPage() {
  const supabase = createClient();
  const [userName, setUserName] = useState("");
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [unsettledBalance, setUnsettledBalance] = useState(0);

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) setUserName(user.user_metadata?.name || user.email || "");

      // Fetch current month transactions
      const now = new Date();
      const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
      const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
      const monthEnd = `${nextMonth.getFullYear()}-${String(nextMonth.getMonth() + 1).padStart(2, "0")}-01`;

      const { data: txs } = await supabase
        .from("transactions")
        .select("*, category:categories(*), account:accounts(*)")
        .gte("date", monthStart)
        .lt("date", monthEnd)
        .order("date", { ascending: false });
      if (txs) setTransactions(txs);

      const { data: cats } = await supabase.from("categories").select("*");
      if (cats) setCategories(cats);

      const { data: accts } = await supabase.from("accounts").select("*").eq("is_active", true);
      if (accts) setAccounts(accts);

      // Calculate unsettled shared balance
      const { data: unsettled } = await supabase
        .from("transactions")
        .select("amount")
        .eq("is_shared", true)
        .in("reimbursement_status", ["none", "pending", "partial"]);
      if (unsettled) {
        const total = unsettled.reduce((s, t) => s + Math.abs(Number(t.amount)) * 0.5, 0);
        setUnsettledBalance(-total);
      }
    })();
  }, [supabase]);

  const expenses = transactions.filter((t) => t.amount > 0 && t.transaction_type === "expense");
  const incomes = transactions.filter((t) => t.amount < 0 || t.transaction_type === "income");

  const totalSpending = expenses.reduce((s, t) => s + t.amount, 0);
  const totalIncome = incomes.reduce((s, t) => s + Math.abs(t.amount), 0);

  // Group spending by category
  const spendingByCategory = new Map<string, { name: string; color: string; total: number }>();
  for (const tx of expenses) {
    const cat = tx.category as Category | undefined;
    const key = cat?.id || "uncategorized";
    const existing = spendingByCategory.get(key) || {
      name: cat?.name || "Uncategorized",
      color: cat?.color || "#D4D4D4",
      total: 0,
    };
    existing.total += tx.amount;
    spendingByCategory.set(key, existing);
  }
  const categoryList = Array.from(spendingByCategory.values()).sort((a, b) => b.total - a.total);

  // Month name
  const monthName = new Date().toLocaleDateString("en-US", { month: "long", year: "numeric" });

  // CTA conditions
  const hasNoImports = transactions.length === 0;
  const hasUnsettled = unsettledBalance < -50;

  return (
    <PageShell userName={userName} unsettledBalance={unsettledBalance}>
      {/* CTAs */}
      {hasNoImports && (
        <div className="border-2 border-sq-blue bg-blue-50 p-6 flex items-center justify-between mb-8">
          <div className="flex items-center gap-3">
            <Upload className="w-5 h-5 text-sq-blue" />
            <div>
              <div className="font-sans font-bold text-[14px] text-sq-black">Import new statements</div>
              <div className="font-sans text-[13px] text-sq-gray-600">Get started by importing your first CSV bank statement.</div>
            </div>
          </div>
          <Link href="/import">
            <Button>Import CSV <ArrowRight className="w-4 h-4" /></Button>
          </Link>
        </div>
      )}

      {hasUnsettled && (
        <div className="border-2 border-sq-purple bg-purple-50 p-6 flex items-center justify-between mb-8">
          <div className="flex items-center gap-3">
            <Scale className="w-5 h-5 text-sq-purple" />
            <div>
              <div className="font-sans font-bold text-[14px] text-sq-black">Settle up with your partner</div>
              <div className="font-sans text-[13px] text-sq-gray-600">
                You have {formatCurrency(Math.abs(unsettledBalance))} in unreimbursed shared expenses.
              </div>
            </div>
          </div>
          <Link href="/reconcile">
            <Button>Settle Up <ArrowRight className="w-4 h-4" /></Button>
          </Link>
        </div>
      )}

      {/* ─── Spending Section ─────────────────── */}
      <div className="mb-12">
        <h2 className="font-sans font-extrabold text-[24px] text-sq-black uppercase tracking-tight mb-6 flex items-center gap-3">
          <TrendingDown className="w-6 h-6 text-sq-red" />
          Spending
        </h2>
        <div className="grid grid-cols-4 gap-6 mb-6">
          <Card>
            <div className="sq-label-muted mb-2">Total ({monthName.split(" ")[0]})</div>
            <div className="font-mono text-[32px] font-bold text-sq-red">
              {formatCurrency(totalSpending)}
            </div>
          </Card>
          {categoryList.slice(0, 3).map((cat) => (
            <Card key={cat.name}>
              <div className="sq-label-muted mb-2">{cat.name}</div>
              <div className="font-mono text-[28px] font-bold text-sq-black">
                {formatCurrency(cat.total)}
              </div>
              <div className="font-sans text-[12px] text-sq-gray-600 mt-1">
                {pct(cat.total, totalSpending)}
              </div>
            </Card>
          ))}
        </div>

        {/* Category table */}
        {categoryList.length > 0 && (
          <div className="border border-sq-black">
            <div className="grid grid-cols-12 gap-4 px-6 py-3 bg-sq-gray-100 border-b border-sq-black">
              <div className="col-span-6 sq-label-muted">Category</div>
              <div className="col-span-3 text-right sq-label-muted">Amount</div>
              <div className="col-span-3 text-right sq-label-muted">% of Total</div>
            </div>
            {categoryList.map((cat) => (
              <div key={cat.name} className="grid grid-cols-12 gap-4 px-6 py-3 border-b border-sq-gray-100 items-center">
                <div className="col-span-6 flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full" style={{ backgroundColor: cat.color }} />
                  <span className="font-sans text-[14px] text-sq-black">{cat.name}</span>
                </div>
                <div className="col-span-3 text-right font-mono text-[14px] text-sq-black font-bold">
                  {formatCurrency(cat.total)}
                </div>
                <div className="col-span-3 text-right font-mono text-[14px] text-sq-gray-600">
                  {pct(cat.total, totalSpending)}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ─── Incomes Section ──────────────────── */}
      <div className="mb-12">
        <h2 className="font-sans font-extrabold text-[24px] text-sq-black uppercase tracking-tight mb-6 flex items-center gap-3">
          <TrendingUp className="w-6 h-6 text-sq-green" />
          Incomes
        </h2>
        <Card>
          <div className="sq-label-muted mb-2">Total Income ({monthName.split(" ")[0]})</div>
          <div className="font-mono text-[32px] font-bold text-sq-green">
            {formatCurrency(totalIncome)}
          </div>
        </Card>
        {incomes.length > 0 && (
          <div className="border border-sq-black mt-6">
            <div className="grid grid-cols-12 gap-4 px-6 py-3 bg-sq-gray-100 border-b border-sq-black">
              <div className="col-span-5 sq-label-muted">Source</div>
              <div className="col-span-4 text-right sq-label-muted">Amount</div>
              <div className="col-span-3 text-right sq-label-muted">Date</div>
            </div>
            {incomes.slice(0, 5).map((tx) => (
              <div key={tx.id} className="grid grid-cols-12 gap-4 px-6 py-3 border-b border-sq-gray-100 items-center">
                <div className="col-span-5 font-sans text-[14px] text-sq-black">{tx.description}</div>
                <div className="col-span-4 text-right font-mono text-[14px] text-sq-green font-bold">
                  {formatCurrency(Math.abs(tx.amount))}
                </div>
                <div className="col-span-3 text-right font-mono text-[13px] text-sq-gray-600">
                  {formatDate(tx.date)}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ─── Transaction List Summary ─────────── */}
      <div>
        <div className="flex justify-between items-center mb-6">
          <h2 className="font-sans font-extrabold text-[24px] text-sq-black uppercase tracking-tight flex items-center gap-3">
            <List className="w-6 h-6 text-sq-black" />
            Recent Transactions
          </h2>
          <Link href="/transactions" className="font-sans font-semibold text-[12px] uppercase tracking-wider text-sq-blue hover:underline flex items-center gap-1">
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
          {transactions.length === 0 ? (
            <div className="px-6 py-8 text-center text-sq-gray-600 font-sans text-[14px]">
              No transactions this month. Import a CSV to get started.
            </div>
          ) : (
            transactions.slice(0, 8).map((tx) => {
              const account = tx.account as Account | undefined;
              return (
                <div key={tx.id} className="grid grid-cols-12 gap-4 px-6 py-3 border-b border-sq-gray-100 items-center">
                  <div className="col-span-2 font-mono text-[13px] text-sq-gray-600">{formatDate(tx.date)}</div>
                  <div className="col-span-5 font-sans text-[14px] text-sq-black truncate">{tx.description}</div>
                  <div className="col-span-3 font-sans text-[12px] text-sq-gray-600 uppercase tracking-wider truncate">
                    {account?.name || "—"}
                  </div>
                  <div className={cn(
                    "col-span-2 text-right font-mono text-[14px] font-bold",
                    tx.amount < 0 ? "text-sq-green" : "text-sq-black"
                  )}>
                    {formatCurrency(tx.amount)}
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

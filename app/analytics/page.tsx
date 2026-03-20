"use client";

export const dynamic = "force-dynamic";

import React, { useState, useEffect, useMemo } from "react";
import { TrendingDown, TrendingUp, Users, Calendar } from "lucide-react";
import { PageShell } from "@/components/layout/PageShell";
import { Card } from "@/components/ui";
import { createClient } from "@/lib/supabase/client";
import { formatCurrency, pct, cn } from "@/lib/utils";
import { buildRateMap, convert } from "@/lib/currency";
import type { Transaction, Category } from "@/lib/types";

type Period = "this_month" | "last_3" | "last_6" | "this_year";

const PERIOD_LABELS: Record<Period, string> = {
  this_month: "This Month",
  last_3: "Last 3 Months",
  last_6: "Last 6 Months",
  this_year: "This Year",
};

function getDateRange(period: Period): { from: string; to: string } {
  const now = new Date();
  const to = now.toISOString().slice(0, 10);
  let from: Date;

  if (period === "this_month") {
    from = new Date(now.getFullYear(), now.getMonth(), 1);
  } else if (period === "last_3") {
    from = new Date(now.getFullYear(), now.getMonth() - 2, 1);
  } else if (period === "last_6") {
    from = new Date(now.getFullYear(), now.getMonth() - 5, 1);
  } else {
    from = new Date(now.getFullYear(), 0, 1);
  }

  return { from: from.toISOString().slice(0, 10), to };
}

// ─── SVG Bar Chart ──────────────────────────────────────────────────────────
function BarChart({
  data,
  height = 180,
}: {
  data: { label: string; value: number; color: string }[];
  height?: number;
}) {
  if (data.length === 0) return null;
  const max = Math.max(...data.map((d) => d.value), 1);
  const barWidth = Math.min(40, Math.floor(560 / data.length) - 8);
  const gap = Math.floor(560 / data.length);
  const svgWidth = data.length * gap;

  return (
    <svg width="100%" viewBox={`0 0 ${svgWidth} ${height + 32}`} className="overflow-visible">
      {data.map((d, i) => {
        const barH = Math.max(2, (d.value / max) * height);
        const x = i * gap + (gap - barWidth) / 2;
        const y = height - barH;
        return (
          <g key={d.label}>
            <rect x={x} y={y} width={barWidth} height={barH} fill={d.color} />
            <text
              x={x + barWidth / 2}
              y={height + 16}
              textAnchor="middle"
              fontSize="10"
              fontFamily="sans-serif"
              fill="#666"
            >
              {d.label.length > 9 ? d.label.slice(0, 8) + "…" : d.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

// ─── SVG Monthly Trend ──────────────────────────────────────────────────────
function TrendChart({ months }: { months: { label: string; spending: number; income: number }[] }) {
  if (months.length === 0) return null;
  const maxVal = Math.max(...months.flatMap((m) => [m.spending, m.income]), 1);
  const W = 600;
  const H = 140;
  const pad = 16;
  const step = (W - pad * 2) / Math.max(months.length - 1, 1);

  const spendPts = months.map((m, i) => `${pad + i * step},${H - (m.spending / maxVal) * (H - 20)}`).join(" ");
  const incPts = months.map((m, i) => `${pad + i * step},${H - (m.income / maxVal) * (H - 20)}`).join(" ");

  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H + 28}`} className="overflow-visible">
      {/* Grid lines */}
      {[0.25, 0.5, 0.75, 1].map((f) => (
        <line
          key={f}
          x1={pad}
          y1={H - f * (H - 20)}
          x2={W - pad}
          y2={H - f * (H - 20)}
          stroke="#E5E5E5"
          strokeWidth="1"
        />
      ))}
      {/* Spending line */}
      <polyline points={spendPts} fill="none" stroke="#E5003E" strokeWidth="2" strokeLinejoin="round" />
      {/* Income line */}
      <polyline points={incPts} fill="none" stroke="#16A34A" strokeWidth="2" strokeLinejoin="round" />
      {/* Dots + labels */}
      {months.map((m, i) => {
        const x = pad + i * step;
        const sy = H - (m.spending / maxVal) * (H - 20);
        const iy = H - (m.income / maxVal) * (H - 20);
        return (
          <g key={m.label}>
            <circle cx={x} cy={sy} r="3" fill="#E5003E" />
            <circle cx={x} cy={iy} r="3" fill="#16A34A" />
            <text x={x} y={H + 16} textAnchor="middle" fontSize="10" fontFamily="sans-serif" fill="#666">
              {m.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

// ─── Page ───────────────────────────────────────────────────────────────────
export default function AnalyticsPage() {
  const supabase = createClient();
  const [userName, setUserName] = useState("");
  const [displayCurrency, setDisplayCurrency] = useState("SEK");
  const [rateMap, setRateMap] = useState(new Map<string, number>());
  const [period, setPeriod] = useState<Period>("this_month");
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getUser().then(async ({ data: { user } }) => {
      if (user) {
        setUserName(user.user_metadata?.name || user.email || "");
        const { data: profile } = await supabase.from("profiles").select("default_currency").eq("id", user.id).single();
        if (profile?.default_currency) setDisplayCurrency(profile.default_currency);
      }
    });
  }, [supabase]);

  useEffect(() => {
    const { from, to } = getDateRange(period);
    setLoading(true);
    supabase
      .from("transactions")
      .select("*, category:categories(*), account:accounts(*)")
      .gte("date", from)
      .lte("date", to)
      .order("date", { ascending: true })
      .then(async ({ data }) => {
        if (data) {
          setTransactions(data);
          const rm = await buildRateMap(data, displayCurrency);
          setRateMap(rm);
        }
        setLoading(false);
      });
  }, [supabase, period, displayCurrency]);

  const expenses = useMemo(
    () => transactions.filter((t) => t.amount > 0 && t.transaction_type === "expense"),
    [transactions]
  );
  const incomes = useMemo(
    () => transactions.filter((t) => t.amount < 0 || t.transaction_type === "income"),
    [transactions]
  );
  const sharedExpenses = useMemo(() => expenses.filter((t) => t.is_shared), [expenses]);
  const personalExpenses = useMemo(() => expenses.filter((t) => !t.is_shared), [expenses]);

  const cvt = (t: Transaction) => convert(t.amount, t.currency, t.date, displayCurrency, rateMap);

  const totalSpending = useMemo(() => expenses.reduce((s, t) => s + cvt(t), 0), [expenses, rateMap]);
  const totalIncome = useMemo(() => incomes.reduce((s, t) => s + Math.abs(cvt(t)), 0), [incomes, rateMap]);
  const totalShared = useMemo(() => sharedExpenses.reduce((s, t) => s + cvt(t), 0), [sharedExpenses, rateMap]);

  // Category breakdown
  const categoryBreakdown = useMemo(() => {
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

  // Monthly trend
  const monthlyTrend = useMemo(() => {
    const map = new Map<string, { spending: number; income: number }>();
    for (const tx of transactions) {
      const label = tx.date.slice(0, 7); // YYYY-MM
      const entry = map.get(label) || { spending: 0, income: 0 };
      const converted = cvt(tx);
      if (tx.amount > 0 && tx.transaction_type === "expense") entry.spending += converted;
      if (tx.amount < 0 || tx.transaction_type === "income") entry.income += Math.abs(converted);
      map.set(label, entry);
    }
    return Array.from(map.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, val]) => ({
        label: new Date(key + "-01").toLocaleDateString("en-US", { month: "short" }),
        ...val,
      }));
  }, [transactions, rateMap]);

  const isEmpty = transactions.length === 0 && !loading;

  return (
    <PageShell userName={userName}>
      {/* Header + period selector */}
      <div className="flex justify-between items-center mb-8">
        <h1 className="font-sans font-extrabold text-[32px] text-sq-black uppercase tracking-tight">
          Analytics
        </h1>
        <div className="flex border-2 border-sq-black">
          {(Object.keys(PERIOD_LABELS) as Period[]).map((p) => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={cn(
                "px-4 py-2 font-sans font-semibold text-[11px] uppercase tracking-wider transition-colors border-r border-sq-black last:border-r-0",
                period === p ? "bg-sq-black text-sq-white" : "text-sq-gray-600 hover:text-sq-black hover:bg-sq-gray-100"
              )}
            >
              {PERIOD_LABELS[p]}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-24 text-sq-gray-400 font-sans text-[14px]">
          Loading…
        </div>
      ) : isEmpty ? (
        <Card className="text-center py-16">
          <p className="font-sans text-[16px] text-sq-gray-600 font-semibold mb-2">No data for this period</p>
          <p className="font-sans text-[14px] text-sq-gray-400">
            Import transactions and categorize them to unlock spending insights.
          </p>
        </Card>
      ) : (
        <>
          {/* ─── Summary Cards ─────────────────── */}
          <div className="grid grid-cols-4 gap-6 mb-10">
            <Card>
              <div className="sq-label-muted mb-2 flex items-center gap-1">
                <TrendingDown className="w-3 h-3 text-sq-red" /> Total Spending
              </div>
              <div className="font-mono text-[28px] font-bold text-sq-red">{formatCurrency(totalSpending, displayCurrency)}</div>
              <div className="font-sans text-[12px] text-sq-gray-400 mt-1">{expenses.length} transactions</div>
            </Card>
            <Card>
              <div className="sq-label-muted mb-2 flex items-center gap-1">
                <TrendingUp className="w-3 h-3 text-sq-green" /> Total Income
              </div>
              <div className="font-mono text-[28px] font-bold text-sq-green">{formatCurrency(totalIncome, displayCurrency)}</div>
              <div className="font-sans text-[12px] text-sq-gray-400 mt-1">{incomes.length} transactions</div>
            </Card>
            <Card>
              <div className="sq-label-muted mb-2 flex items-center gap-1">
                <Users className="w-3 h-3 text-amber-500" /> Shared Expenses
              </div>
              <div className="font-mono text-[28px] font-bold text-sq-black">{formatCurrency(totalShared, displayCurrency)}</div>
              <div className="font-sans text-[12px] text-sq-gray-400 mt-1">
                {pct(totalShared, totalSpending)} of spending
              </div>
            </Card>
            <Card>
              <div className="sq-label-muted mb-2 flex items-center gap-1">
                <Calendar className="w-3 h-3 text-sq-blue" /> Net Position
              </div>
              <div
                className={cn(
                  "font-mono text-[28px] font-bold",
                  totalIncome - totalSpending >= 0 ? "text-sq-green" : "text-sq-red"
                )}
              >
                {formatCurrency(totalIncome - totalSpending, displayCurrency)}
              </div>
              <div className="font-sans text-[12px] text-sq-gray-400 mt-1">income minus spending</div>
            </Card>
          </div>

          {/* ─── Category Breakdown ────────────── */}
          <div className="grid grid-cols-2 gap-8 mb-10">
            <div>
              <h2 className="font-sans font-extrabold text-[18px] text-sq-black uppercase tracking-tight mb-4">
                Spending by Category
              </h2>
              {categoryBreakdown.length === 0 ? (
                <Card className="py-8 text-center text-sq-gray-400 font-sans text-[13px]">
                  No categorized expenses
                </Card>
              ) : (
                <>
                  <div className="mb-6 px-2">
                    <BarChart
                      data={categoryBreakdown.slice(0, 8).map((c) => ({
                        label: c.name,
                        value: c.total,
                        color: c.color,
                      }))}
                    />
                  </div>
                  <div className="border border-sq-black">
                    <div className="grid grid-cols-12 gap-4 px-4 py-2 bg-sq-gray-100 border-b border-sq-black">
                      <div className="col-span-6 sq-label-muted">Category</div>
                      <div className="col-span-3 text-right sq-label-muted">Amount</div>
                      <div className="col-span-3 text-right sq-label-muted">Share</div>
                    </div>
                    {categoryBreakdown.map((cat) => (
                      <div
                        key={cat.name}
                        className="grid grid-cols-12 gap-4 px-4 py-2.5 border-b border-sq-gray-100 items-center"
                      >
                        <div className="col-span-6 flex items-center gap-2">
                          <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: cat.color }} />
                          <span className="font-sans text-[13px] text-sq-black">{cat.name}</span>
                        </div>
                        <div className="col-span-3 text-right font-mono text-[13px] text-sq-black font-bold">
                          {formatCurrency(cat.total, displayCurrency)}
                        </div>
                        <div className="col-span-3 text-right font-mono text-[13px] text-sq-gray-600">
                          {pct(cat.total, totalSpending)}
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>

            {/* ─── Shared vs Personal ────────────── */}
            <div>
              <h2 className="font-sans font-extrabold text-[18px] text-sq-black uppercase tracking-tight mb-4">
                Shared vs Personal
              </h2>
              <div className="space-y-4 mb-6">
                {[
                  { label: "Shared", value: totalShared, color: "#F59E0B", count: sharedExpenses.length },
                  {
                    label: "Personal",
                    value: totalSpending - totalShared,
                    color: "#0066FF",
                    count: personalExpenses.length,
                  },
                ].map((item) => (
                  <Card key={item.label}>
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <div className="w-3 h-3 rounded-full" style={{ backgroundColor: item.color }} />
                        <span className="font-sans font-semibold text-[14px] text-sq-black">{item.label}</span>
                        <span className="font-sans text-[12px] text-sq-gray-400">({item.count} txns)</span>
                      </div>
                      <span className="font-mono font-bold text-[18px] text-sq-black">
                        {formatCurrency(item.value, displayCurrency)}
                      </span>
                    </div>
                    <div className="h-2 bg-sq-gray-100 border border-sq-gray-100">
                      <div
                        className="h-full"
                        style={{
                          width: pct(item.value, totalSpending),
                          backgroundColor: item.color,
                        }}
                      />
                    </div>
                    <div className="mt-1 font-sans text-[12px] text-sq-gray-400">
                      {pct(item.value, totalSpending)} of total spending
                    </div>
                  </Card>
                ))}
              </div>

              {/* ─── Monthly Trend ────────────────── */}
              {monthlyTrend.length > 1 && (
                <>
                  <h2 className="font-sans font-extrabold text-[18px] text-sq-black uppercase tracking-tight mb-4 mt-8">
                    Monthly Trend
                  </h2>
                  <div className="px-2 mb-2">
                    <TrendChart months={monthlyTrend} />
                  </div>
                  <div className="flex gap-4 font-sans text-[12px] text-sq-gray-600">
                    <span className="flex items-center gap-1.5">
                      <span className="w-3 h-0.5 bg-sq-red inline-block" /> Spending
                    </span>
                    <span className="flex items-center gap-1.5">
                      <span className="w-3 h-0.5 bg-sq-green inline-block" /> Income
                    </span>
                  </div>
                </>
              )}
            </div>
          </div>
        </>
      )}
    </PageShell>
  );
}

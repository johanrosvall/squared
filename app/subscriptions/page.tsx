"use client";

export const dynamic = "force-dynamic";

import React, { useState, useEffect, useMemo } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { PageShell } from "@/components/layout/PageShell";
import { Card } from "@/components/ui";
import { createClient } from "@/lib/supabase/client";
import { formatCurrency, formatDate } from "@/lib/utils";
import type { Transaction } from "@/lib/types";

interface DetectedSub {
  description: string;
  frequency: string;
  intervalDays: number;
  averageAmount: number;
  lastDate: string;
  nextExpected: string;
  totalSpent: number;
  occurrences: number;
  transactions: Transaction[];
}

function daysBetween(a: string, b: string): number {
  return Math.round((new Date(b).getTime() - new Date(a).getTime()) / 86400000);
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function detectSubs(transactions: Transaction[]): DetectedSub[] {
  const groups = new Map<string, Transaction[]>();
  for (const tx of transactions) {
    if (tx.amount <= 0) continue; // expenses only (positive = expense in our schema)
    const key = tx.description.toLowerCase().trim();
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(tx);
  }

  const subs: DetectedSub[] = [];

  for (const [, txs] of groups) {
    if (txs.length < 2) continue;

    const sorted = [...txs].sort((a, b) => a.date.localeCompare(b.date));

    // Compute day intervals between consecutive occurrences
    const intervals: number[] = [];
    for (let i = 1; i < sorted.length; i++) {
      intervals.push(daysBetween(sorted[i - 1].date, sorted[i].date));
    }

    const meanInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length;
    const stdDev = Math.sqrt(
      intervals.reduce((acc, v) => acc + Math.pow(v - meanInterval, 2), 0) / intervals.length
    );

    // Reject if intervals are too irregular (allow more slack with more data)
    if (stdDev > meanInterval * 0.4 && txs.length < 4) continue;

    // Classify into known frequencies
    let frequency: string;
    let intervalDays: number;
    if (meanInterval >= 6 && meanInterval <= 9)        { frequency = "Weekly";    intervalDays = 7; }
    else if (meanInterval >= 12 && meanInterval <= 16) { frequency = "Biweekly";  intervalDays = 14; }
    else if (meanInterval >= 25 && meanInterval <= 45) { frequency = "Monthly";   intervalDays = 30; }
    else if (meanInterval >= 80 && meanInterval <= 100){ frequency = "Quarterly"; intervalDays = 90; }
    else if (meanInterval >= 340 && meanInterval <= 390){ frequency = "Annual";   intervalDays = 365; }
    else continue;

    // Reject if amounts vary too wildly
    const amounts = sorted.map((t) => Math.abs(t.amount));
    const avgAmount = amounts.reduce((a, b) => a + b, 0) / amounts.length;
    const amountStdDev = Math.sqrt(
      amounts.reduce((acc, a) => acc + Math.pow(a - avgAmount, 2), 0) / amounts.length
    );
    if (amountStdDev > avgAmount * 0.3) continue;

    const lastDate = sorted[sorted.length - 1].date;

    subs.push({
      description: sorted[0].description,
      frequency,
      intervalDays,
      averageAmount: avgAmount,
      lastDate,
      nextExpected: addDays(lastDate, intervalDays),
      totalSpent: amounts.reduce((a, b) => a + b, 0),
      occurrences: sorted.length,
      transactions: sorted,
    });
  }

  return subs.sort((a, b) => b.totalSpent - a.totalSpent);
}

export default function SubscriptionsPage() {
  const supabase = createClient();
  const [userName, setUserName] = useState("");
  const [displayCurrency, setDisplayCurrency] = useState("SEK");
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);

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
        if (profile?.default_currency) setDisplayCurrency(profile.default_currency);
      }
      const { data } = await supabase
        .from("transactions")
        .select("*")
        .order("date", { ascending: true });
      if (data) setTransactions(data);
      setLoading(false);
    })();
  }, [supabase]);

  const subscriptions = useMemo(() => detectSubs(transactions), [transactions]);

  const isOverdue = (nextExpected: string) =>
    new Date(nextExpected) < new Date();

  return (
    <PageShell userName={userName}>
      <div className="flex justify-between items-end mb-8">
        <h1 className="font-sans font-extrabold text-[32px] text-sq-black uppercase tracking-tight">
          Subscriptions
        </h1>
        <div className="font-sans text-[13px] text-sq-gray-600">
          {subscriptions.length} detected
        </div>
      </div>

      {loading ? (
        <div className="text-center py-16 text-sq-gray-600 font-sans text-[14px]">
          Analyzing transactions…
        </div>
      ) : subscriptions.length === 0 ? (
        <Card className="text-center py-16">
          <p className="font-sans text-sq-gray-600 text-[15px]">
            No recurring charges detected. Import more transaction history for better detection.
          </p>
        </Card>
      ) : (
        <div className="border-2 border-sq-black">
          {/* Header */}
          <div className="grid grid-cols-12 gap-4 px-6 py-3 bg-sq-gray-100 border-b border-sq-black">
            <div className="col-span-4 sq-label-muted">Name</div>
            <div className="col-span-2 sq-label-muted">Frequency</div>
            <div className="col-span-2 text-right sq-label-muted">Per Charge</div>
            <div className="col-span-2 text-right sq-label-muted">Total Spent</div>
            <div className="col-span-2 text-right sq-label-muted">Next Expected</div>
          </div>

          {subscriptions.map((sub) => (
            <div key={sub.description}>
              <div
                onClick={() => setExpanded(expanded === sub.description ? null : sub.description)}
                className="grid grid-cols-12 gap-4 px-6 py-4 border-b border-sq-gray-100 items-center cursor-pointer hover:bg-sq-gray-100 transition-colors"
              >
                <div className="col-span-4 flex items-center gap-2">
                  {expanded === sub.description
                    ? <ChevronDown className="w-4 h-4 text-sq-gray-600 flex-shrink-0" />
                    : <ChevronRight className="w-4 h-4 text-sq-gray-600 flex-shrink-0" />
                  }
                  <span className="font-sans font-semibold text-[14px] text-sq-black truncate">
                    {sub.description}
                  </span>
                </div>

                <div className="col-span-2">
                  <span className="font-sans text-[11px] uppercase tracking-wider font-semibold text-sq-blue border border-sq-blue px-2 py-0.5">
                    {sub.frequency}
                  </span>
                </div>

                <div className="col-span-2 text-right font-mono text-[14px] font-bold text-sq-red">
                  {formatCurrency(sub.averageAmount, displayCurrency)}
                </div>

                <div className="col-span-2 text-right font-mono text-[14px] text-sq-black">
                  {formatCurrency(sub.totalSpent, displayCurrency)}
                </div>

                <div className={`col-span-2 text-right font-sans text-[13px] ${isOverdue(sub.nextExpected) ? "text-sq-red font-semibold" : "text-sq-gray-600"}`}>
                  {formatDate(sub.nextExpected)}
                  {isOverdue(sub.nextExpected) && <span className="ml-1 text-[11px]">(due)</span>}
                </div>
              </div>

              {expanded === sub.description && (
                <div className="bg-sq-gray-100 border-b border-sq-black px-8 py-4">
                  <div className="sq-label-muted mb-3">
                    {sub.occurrences} charges · last on {formatDate(sub.lastDate)}
                  </div>
                  <div className="space-y-0">
                    {sub.transactions.map((tx) => (
                      <div
                        key={tx.id}
                        className="flex justify-between items-center py-2 border-b border-sq-gray-100 last:border-0"
                      >
                        <span className="font-mono text-[13px] text-sq-gray-600">
                          {formatDate(tx.date)}
                        </span>
                        <span className="font-mono text-[13px] font-bold text-sq-red">
                          {formatCurrency(Math.abs(tx.amount), tx.currency || displayCurrency)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </PageShell>
  );
}

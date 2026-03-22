"use client";

export const dynamic = "force-dynamic";

import React, { useState, useEffect, useMemo } from "react";
import { ChevronDown, ChevronRight, Pencil, EyeOff, Eye, Check, X } from "lucide-react";
import { PageShell } from "@/components/layout/PageShell";
import { Card, Button } from "@/components/ui";
import { createClient } from "@/lib/supabase/client";
import { formatCurrency, formatDate } from "@/lib/utils";
import type { Transaction } from "@/lib/types";

const LS_KEY = "sq_sub_overrides";

interface SubOverride {
  customName: string;
  notes: string;
  hidden: boolean;
}

function loadOverrides(): Record<string, SubOverride> {
  try {
    const raw = localStorage.getItem(LS_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}

function saveOverrides(overrides: Record<string, SubOverride>) {
  localStorage.setItem(LS_KEY, JSON.stringify(overrides));
}

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
    if (tx.amount <= 0) continue;
    const key = tx.description.toLowerCase().trim();
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(tx);
  }

  const subs: DetectedSub[] = [];

  for (const [, txs] of Array.from(groups.entries())) {
    if (txs.length < 2) continue;

    const sorted = [...txs].sort((a, b) => a.date.localeCompare(b.date));

    const intervals: number[] = [];
    for (let i = 1; i < sorted.length; i++) {
      intervals.push(daysBetween(sorted[i - 1].date, sorted[i].date));
    }

    const meanInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length;
    const stdDev = Math.sqrt(
      intervals.reduce((acc, v) => acc + Math.pow(v - meanInterval, 2), 0) / intervals.length
    );

    if (stdDev > meanInterval * 0.4 && txs.length < 4) continue;

    let frequency: string;
    let intervalDays: number;
    if (meanInterval >= 6 && meanInterval <= 9)         { frequency = "Weekly";    intervalDays = 7; }
    else if (meanInterval >= 12 && meanInterval <= 16)  { frequency = "Biweekly";  intervalDays = 14; }
    else if (meanInterval >= 25 && meanInterval <= 45)  { frequency = "Monthly";   intervalDays = 30; }
    else if (meanInterval >= 80 && meanInterval <= 100) { frequency = "Quarterly"; intervalDays = 90; }
    else if (meanInterval >= 340 && meanInterval <= 390){ frequency = "Annual";    intervalDays = 365; }
    else continue;

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
  const [showHidden, setShowHidden] = useState(false);

  // Overrides: keyed by original description
  const [overrides, setOverrides] = useState<Record<string, SubOverride>>({});

  // Edit state
  const [editing, setEditing] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editNotes, setEditNotes] = useState("");

  useEffect(() => {
    setOverrides(loadOverrides());
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

  const isOverdue = (nextExpected: string) => new Date(nextExpected) < new Date();

  const getOverride = (desc: string): SubOverride =>
    overrides[desc] ?? { customName: "", notes: "", hidden: false };

  const patchOverride = (desc: string, patch: Partial<SubOverride>) => {
    const updated = { ...overrides, [desc]: { ...getOverride(desc), ...patch } };
    setOverrides(updated);
    saveOverrides(updated);
  };

  const startEdit = (desc: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const ov = getOverride(desc);
    setEditName(ov.customName);
    setEditNotes(ov.notes);
    setEditing(desc);
  };

  const saveEdit = (desc: string) => {
    patchOverride(desc, { customName: editName.trim(), notes: editNotes.trim() });
    setEditing(null);
  };

  const toggleHidden = (desc: string, e: React.MouseEvent) => {
    e.stopPropagation();
    patchOverride(desc, { hidden: !getOverride(desc).hidden });
  };

  const visible = subscriptions.filter((s) => showHidden || !getOverride(s.description).hidden);
  const hiddenCount = subscriptions.filter((s) => getOverride(s.description).hidden).length;

  return (
    <PageShell userName={userName}>
      <div className="flex justify-between items-end mb-8">
        <h1 className="font-sans font-extrabold text-[32px] text-sq-black uppercase tracking-tight">
          Subscriptions
        </h1>
        <div className="flex items-center gap-4">
          {hiddenCount > 0 && (
            <button
              onClick={() => setShowHidden(!showHidden)}
              className="flex items-center gap-1.5 font-sans text-[12px] uppercase font-semibold text-sq-gray-600 hover:text-sq-black transition-colors"
            >
              {showHidden ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
              {showHidden ? "Hide" : `Show ${hiddenCount} hidden`}
            </button>
          )}
          <div className="font-sans text-[13px] text-sq-gray-600">
            {visible.length} subscription{visible.length !== 1 ? "s" : ""}
          </div>
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

          {visible.map((sub) => {
            const ov = getOverride(sub.description);
            const displayName = ov.customName || sub.description;
            const isHidden = ov.hidden;
            const isEditing = editing === sub.description;
            const isExpanded = expanded === sub.description;

            return (
              <div key={sub.description} className={isHidden ? "opacity-40" : ""}>
                {/* Main row */}
                <div
                  onClick={() => !isEditing && setExpanded(isExpanded ? null : sub.description)}
                  className="grid grid-cols-12 gap-4 px-6 py-4 border-b border-sq-gray-100 items-center cursor-pointer hover:bg-sq-gray-100 transition-colors"
                >
                  <div className="col-span-4 flex items-center gap-2 min-w-0">
                    {isExpanded
                      ? <ChevronDown className="w-4 h-4 text-sq-gray-600 flex-shrink-0" />
                      : <ChevronRight className="w-4 h-4 text-sq-gray-600 flex-shrink-0" />
                    }
                    <div className="min-w-0">
                      <div className="font-sans font-semibold text-[14px] text-sq-black truncate">
                        {displayName}
                      </div>
                      {ov.customName && (
                        <div className="font-sans text-[11px] text-sq-gray-400 truncate">
                          {sub.description}
                        </div>
                      )}
                      {ov.notes && (
                        <div className="font-sans text-[11px] text-sq-gray-600 truncate italic">
                          {ov.notes}
                        </div>
                      )}
                    </div>
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

                  <div className="col-span-2 flex items-center justify-end gap-2">
                    <span className={`font-sans text-[13px] ${isOverdue(sub.nextExpected) ? "text-sq-red font-semibold" : "text-sq-gray-600"}`}>
                      {formatDate(sub.nextExpected)}
                    </span>
                    <button
                      onClick={(e) => startEdit(sub.description, e)}
                      className="text-sq-gray-400 hover:text-sq-black transition-colors flex-shrink-0"
                      title="Edit"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={(e) => toggleHidden(sub.description, e)}
                      className="text-sq-gray-400 hover:text-sq-black transition-colors flex-shrink-0"
                      title={isHidden ? "Show" : "Hide"}
                    >
                      {isHidden ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                </div>

                {/* Edit panel */}
                {isEditing && (
                  <div className="bg-sq-gray-100 border-b border-sq-black px-8 py-4">
                    <div className="grid grid-cols-2 gap-4 mb-3">
                      <div>
                        <label className="block sq-label-muted mb-1">Custom Name</label>
                        <input
                          autoFocus
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                          placeholder={sub.description}
                          className="w-full border-2 border-sq-black px-3 py-2 font-sans text-[13px] outline-none focus:border-sq-blue bg-white"
                        />
                      </div>
                      <div>
                        <label className="block sq-label-muted mb-1">Notes</label>
                        <input
                          value={editNotes}
                          onChange={(e) => setEditNotes(e.target.value)}
                          placeholder="e.g. Shared with partner"
                          className="w-full border-2 border-sq-black px-3 py-2 font-sans text-[13px] outline-none focus:border-sq-blue bg-white"
                        />
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <Button size="sm" onClick={() => saveEdit(sub.description)}>
                        <Check className="w-3 h-3" /> Save
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>
                        <X className="w-3 h-3" /> Cancel
                      </Button>
                    </div>
                  </div>
                )}

                {/* Charge history */}
                {isExpanded && !isEditing && (
                  <div className="bg-sq-gray-100 border-b border-sq-black px-8 py-4">
                    <div className="sq-label-muted mb-3">
                      {sub.occurrences} charges · last on {formatDate(sub.lastDate)}
                    </div>
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
                )}
              </div>
            );
          })}
        </div>
      )}
    </PageShell>
  );
}

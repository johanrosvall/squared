"use client";

export const dynamic = "force-dynamic";

import React, { useState, useEffect, useMemo } from "react";
import { ChevronDown, ChevronRight, Pencil, EyeOff, Eye, Check, X } from "lucide-react";
import { PageShell } from "@/components/layout/PageShell";
import { Card, Button } from "@/components/ui";
import { createClient } from "@/lib/supabase/client";
import { formatCurrency, formatDate } from "@/lib/utils";
import type { Transaction, Category } from "@/lib/types";

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
  lastAmount: number;
  lastDate: string;
  nextExpected: string;
  totalSpent: number;
  occurrences: number;
  transactions: Transaction[];
  topCategoryId: string | null;
}

function daysBetween(a: string, b: string): number {
  return Math.round((new Date(b).getTime() - new Date(a).getTime()) / 86400000);
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function detectSubs(transactions: Transaction[], dataHorizon: string): DetectedSub[] {
  // Only consider transactions within the last 2 years of the data horizon.
  // This prevents subscriptions that stopped years ago from appearing as active.
  const cutoff = new Date(dataHorizon);
  cutoff.setFullYear(cutoff.getFullYear() - 2);
  const cutoffStr = cutoff.toISOString().slice(0, 10);
  const recent = transactions.filter((t) => t.date >= cutoffStr);

  const groups = new Map<string, Transaction[]>();
  for (const tx of recent) {
    // Skip zero-amount, income, and internal transfers — keep expenses regardless of sign
    if (tx.amount === 0) continue;
    if (tx.transaction_type === "income" || tx.transaction_type === "internal_transfer") continue;
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
    const lastAmount = Math.abs(sorted[sorted.length - 1].amount);

    // Most common category_id across transactions
    const freq = new Map<string | null, number>();
    for (const tx of sorted) {
      freq.set(tx.category_id ?? null, (freq.get(tx.category_id ?? null) ?? 0) + 1);
    }
    let topCategoryId: string | null = null;
    let topCount = 0;
    for (const [cid, cnt] of Array.from(freq.entries())) {
      if (cnt > topCount) { topCount = cnt; topCategoryId = cid; }
    }

    subs.push({
      description: sorted[0].description,
      frequency,
      intervalDays,
      averageAmount: avgAmount,
      lastAmount,
      lastDate,
      nextExpected: addDays(lastDate, intervalDays),
      totalSpent: amounts.reduce((a, b) => a + b, 0),
      occurrences: sorted.length,
      transactions: sorted,
      topCategoryId,
    });
  }

  return subs.sort((a, b) => b.totalSpent - a.totalSpent);
}

function isActive(sub: DetectedSub, dataHorizon: string): boolean {
  const daysSinceLast = daysBetween(sub.lastDate, dataHorizon);
  return daysSinceLast <= sub.intervalDays * 1.5;
}

function monthlyEquivalent(sub: DetectedSub): number {
  return sub.lastAmount * (30 / sub.intervalDays);
}

// --- Simple SVG pie chart ---
interface PieSlice {
  catId: string | null;
  monthly: number;
  color: string;
  label: string;
}

function PieChart({ slices, size = 180 }: { slices: PieSlice[]; size?: number }) {
  const total = slices.reduce((s, r) => s + r.monthly, 0);
  if (total === 0) return null;

  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2 - 4;

  let cumAngle = -Math.PI / 2;
  const paths: { d: string; color: string; key: string }[] = [];

  for (const slice of slices) {
    const angle = (slice.monthly / total) * 2 * Math.PI;
    const x1 = cx + r * Math.cos(cumAngle);
    const y1 = cy + r * Math.sin(cumAngle);
    const x2 = cx + r * Math.cos(cumAngle + angle);
    const y2 = cy + r * Math.sin(cumAngle + angle);
    const largeArc = angle > Math.PI ? 1 : 0;

    if (slices.length === 1) {
      paths.push({
        d: `M ${cx} ${cy} m -${r} 0 a ${r} ${r} 0 1 1 ${r * 2} 0 a ${r} ${r} 0 1 1 -${r * 2} 0`,
        color: slice.color,
        key: slice.catId ?? "__none__",
      });
    } else {
      paths.push({
        d: `M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${largeArc} 1 ${x2} ${y2} Z`,
        color: slice.color,
        key: slice.catId ?? "__none__",
      });
    }
    cumAngle += angle;
  }

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      {paths.map((p) => (
        <path key={p.key} d={p.d} fill={p.color} stroke="white" strokeWidth={2} />
      ))}
    </svg>
  );
}

// --- Sub table ---
function SubTable({
  subs,
  categories,
  displayCurrency,
  overrides,
  expanded,
  setExpanded,
  editing,
  editName,
  editNotes,
  setEditName,
  setEditNotes,
  startEdit,
  saveEdit,
  setEditing,
  toggleHidden,
  dataHorizon,
}: {
  subs: DetectedSub[];
  categories: Category[];
  displayCurrency: string;
  overrides: Record<string, SubOverride>;
  expanded: string | null;
  setExpanded: (v: string | null) => void;
  editing: string | null;
  editName: string;
  editNotes: string;
  setEditName: (v: string) => void;
  setEditNotes: (v: string) => void;
  startEdit: (desc: string, e: React.MouseEvent) => void;
  saveEdit: (desc: string) => void;
  setEditing: (v: string | null) => void;
  toggleHidden: (desc: string, e: React.MouseEvent) => void;
  dataHorizon: string;
}) {
  const isOverdue = (next: string) => next < dataHorizon;
  const getOverride = (desc: string): SubOverride =>
    overrides[desc] ?? { customName: "", notes: "", hidden: false };

  return (
    <div className="border-2 border-sq-black">
      <div className="grid grid-cols-12 gap-4 px-6 py-3 bg-sq-gray-100 border-b border-sq-black">
        <div className="col-span-3 sq-label-muted">Name</div>
        <div className="col-span-2 sq-label-muted">Category</div>
        <div className="col-span-2 sq-label-muted">Frequency</div>
        <div className="col-span-2 text-right sq-label-muted">Per Charge</div>
        <div className="col-span-1 text-right sq-label-muted">Charges</div>
        <div className="col-span-2 text-right sq-label-muted">Last Seen</div>
      </div>

      {subs.map((sub) => {
        const ov = getOverride(sub.description);
        const displayName = ov.customName || sub.description;
        const isHidden = ov.hidden;
        const isEditing = editing === sub.description;
        const isExpanded = expanded === sub.description;
        const cat = sub.topCategoryId ? categories.find((c) => c.id === sub.topCategoryId) : null;

        return (
          <div key={sub.description} className={isHidden ? "opacity-40" : ""}>
            <div
              onClick={() => !isEditing && setExpanded(isExpanded ? null : sub.description)}
              className="grid grid-cols-12 gap-4 px-6 py-4 border-b border-sq-gray-100 items-center cursor-pointer hover:bg-sq-gray-100 transition-colors"
            >
              <div className="col-span-3 flex items-center gap-2 min-w-0">
                {isExpanded
                  ? <ChevronDown className="w-4 h-4 text-sq-gray-600 flex-shrink-0" />
                  : <ChevronRight className="w-4 h-4 text-sq-gray-600 flex-shrink-0" />
                }
                <div className="min-w-0">
                  <div className="font-sans font-semibold text-[14px] text-sq-black truncate">{displayName}</div>
                  {ov.customName && (
                    <div className="font-sans text-[11px] text-sq-gray-400 truncate">{sub.description}</div>
                  )}
                  {ov.notes && (
                    <div className="font-sans text-[11px] text-sq-gray-600 truncate italic">{ov.notes}</div>
                  )}
                </div>
              </div>

              <div className="col-span-2 flex items-center gap-1.5 min-w-0">
                {cat ? (
                  <>
                    <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: cat.color || "#D4D4D4" }} />
                    <span className="font-sans text-[13px] text-sq-black truncate">{cat.name}</span>
                  </>
                ) : (
                  <span className="font-sans text-[12px] text-sq-gray-400">—</span>
                )}
              </div>

              <div className="col-span-2">
                <span className="font-sans text-[11px] uppercase tracking-wider font-semibold text-sq-blue border border-sq-blue px-2 py-0.5">
                  {sub.frequency}
                </span>
              </div>

              <div className="col-span-2 text-right font-mono text-[14px] font-bold text-sq-red">
                {formatCurrency(sub.lastAmount, displayCurrency)}
              </div>

              <div className="col-span-1 text-right font-mono text-[13px] text-sq-gray-600">
                {sub.occurrences}
              </div>

              <div className="col-span-2 flex items-center justify-end gap-2">
                <span className={`font-sans text-[13px] ${isOverdue(sub.nextExpected) ? "text-sq-red font-semibold" : "text-sq-gray-600"}`}>
                  {formatDate(sub.lastDate)}
                </span>
                <button onClick={(e) => startEdit(sub.description, e)} className="text-sq-gray-400 hover:text-sq-black transition-colors flex-shrink-0" title="Edit">
                  <Pencil className="w-3.5 h-3.5" />
                </button>
                <button onClick={(e) => toggleHidden(sub.description, e)} className="text-sq-gray-400 hover:text-sq-black transition-colors flex-shrink-0" title={isHidden ? "Show" : "Hide"}>
                  {isHidden ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                </button>
              </div>
            </div>

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

            {isExpanded && !isEditing && (
              <div className="bg-sq-gray-100 border-b border-sq-black px-8 py-4">
                <div className="sq-label-muted mb-3">
                  {sub.occurrences} charges · last on {formatDate(sub.lastDate)} · next expected {formatDate(sub.nextExpected)}
                </div>
                {sub.transactions.map((tx) => (
                  <div key={tx.id} className="flex justify-between items-center py-2 border-b border-sq-gray-100 last:border-0">
                    <span className="font-mono text-[13px] text-sq-gray-600">{formatDate(tx.date)}</span>
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
  );
}

// Fallback colors for categories without a color set
const FALLBACK_COLORS = ["#3B82F6","#10B981","#F59E0B","#EF4444","#8B5CF6","#EC4899","#14B8A6","#F97316","#6366F1","#84CC16"];

export default function SubscriptionsPage() {
  const supabase = createClient();
  const [userName, setUserName] = useState("");
  const [displayCurrency, setDisplayCurrency] = useState("SEK");
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [showHidden, setShowHidden] = useState(false);
  const [overrides, setOverrides] = useState<Record<string, SubOverride>>({});
  const [editing, setEditing] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editNotes, setEditNotes] = useState("");

  useEffect(() => {
    setOverrides(loadOverrides());
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        setUserName(user.user_metadata?.name || user.email || "");
        const { data: profile } = await supabase.from("profiles").select("default_currency").eq("id", user.id).single();
        if (profile?.default_currency) setDisplayCurrency(profile.default_currency);
      }
      const [{ data: txData }, { data: catData }] = await Promise.all([
        supabase.from("transactions").select("*").order("date", { ascending: true }),
        supabase.from("categories").select("*").order("name"),
      ]);
      if (txData) setTransactions(txData);
      if (catData) setCategories(catData);
      setLoading(false);
    })();
  }, [supabase]);

  // Use the latest transaction date as the reference point instead of today,
  // so subscriptions aren't wrongly classified as "past" just because no
  // data has been uploaded yet for recent months.
  const dataHorizon = useMemo(() => {
    if (transactions.length === 0) return new Date().toISOString().slice(0, 10);
    return transactions.reduce((max, t) => t.date > max ? t.date : max, transactions[0].date);
  }, [transactions]);

  const allSubs = useMemo(() => detectSubs(transactions, dataHorizon), [transactions, dataHorizon]);

  // For tables: respects showHidden toggle
  const activeSubs = useMemo(() =>
    allSubs.filter((s) => isActive(s, dataHorizon) && (showHidden || !(overrides[s.description]?.hidden))),
    [allSubs, dataHorizon, overrides, showHidden]
  );
  const pastSubs = useMemo(() =>
    allSubs.filter((s) => !isActive(s, dataHorizon) && (showHidden || !(overrides[s.description]?.hidden))),
    [allSubs, dataHorizon, overrides, showHidden]
  );

  const hiddenCount = useMemo(() => allSubs.filter((s) => overrides[s.description]?.hidden).length, [allSubs, overrides]);

  // For overview: always exclude hidden subs regardless of showHidden toggle
  const activeSubsVisible = useMemo(() =>
    allSubs.filter((s) => isActive(s, dataHorizon) && !overrides[s.description]?.hidden),
    [allSubs, dataHorizon, overrides]
  );

  // Total monthly cost — only non-hidden active subs
  const totalMonthly = useMemo(() => activeSubsVisible.reduce((sum, s) => sum + monthlyEquivalent(s), 0), [activeSubsVisible]);

  // Category breakdown for active non-hidden subs → pie chart slices
  const pieSlices = useMemo((): PieSlice[] => {
    const totals = new Map<string | null, number>();
    for (const sub of activeSubsVisible) {
      totals.set(sub.topCategoryId, (totals.get(sub.topCategoryId) ?? 0) + monthlyEquivalent(sub));
    }
    let colorIdx = 0;
    return Array.from(totals.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([catId, monthly]) => {
        const cat = catId ? categories.find((c) => c.id === catId) : null;
        const color = cat?.color || FALLBACK_COLORS[colorIdx++ % FALLBACK_COLORS.length];
        return { catId, monthly, color, label: cat?.name ?? "Uncategorized" };
      });
  }, [activeSubsVisible, categories]);

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

  const tableProps = { categories, displayCurrency, overrides, expanded, setExpanded, editing, editName, editNotes, setEditName, setEditNotes, startEdit, saveEdit, setEditing, toggleHidden, dataHorizon };

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
              {showHidden ? "Hide hidden" : `Show ${hiddenCount} hidden`}
            </button>
          )}
        </div>
      </div>

      {loading ? (
        <div className="text-center py-16 text-sq-gray-600 font-sans text-[14px]">Analyzing transactions…</div>
      ) : allSubs.length === 0 ? (
        <Card className="text-center py-16">
          <p className="font-sans text-sq-gray-600 text-[15px]">
            No recurring charges detected. Import more transaction history for better detection.
          </p>
        </Card>
      ) : (
        <>
          {/* Summary + Pie chart */}
          {pieSlices.length > 0 && (
            <div className="mb-10 border-2 border-sq-black">
              <div className="flex items-stretch">
                {/* Pie */}
                <div className="flex items-center justify-center px-8 py-6 border-r border-sq-gray-100">
                  <PieChart slices={pieSlices} size={160} />
                </div>

                {/* Legend + total */}
                <div className="flex-1 flex flex-col justify-between px-6 py-5">
                  <div>
                    <div className="font-sans font-bold text-[11px] uppercase tracking-wider text-sq-gray-600 mb-3">
                      Monthly cost by category (active)
                    </div>
                    <div className="space-y-2">
                      {pieSlices.map((s) => (
                        <div key={s.catId ?? "__none__"} className="flex items-center justify-between">
                          <span className="flex items-center gap-2 font-sans text-[13px] text-sq-black">
                            <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: s.color }} />
                            {s.label}
                          </span>
                          <span className="font-mono text-[13px] font-bold text-sq-red ml-6">
                            {formatCurrency(s.monthly, displayCurrency)}
                            <span className="font-sans text-[10px] font-normal text-sq-gray-400">/mo</span>
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="flex items-center justify-between mt-4 pt-4 border-t border-sq-gray-100">
                    <span className="font-sans font-bold text-[13px] uppercase tracking-wider text-sq-black">Total expected</span>
                    <span className="font-mono text-[18px] font-bold text-sq-red">
                      {formatCurrency(totalMonthly, displayCurrency)}
                      <span className="font-sans text-[12px] font-normal text-sq-gray-400">/mo</span>
                    </span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Active subscriptions */}
          <div className="mb-8">
            <h2 className="font-sans font-bold text-[13px] uppercase tracking-wider text-sq-black mb-3">
              Active Subscriptions
              <span className="ml-2 font-normal text-sq-gray-600">({activeSubs.length})</span>
            </h2>
            {activeSubs.length === 0 ? (
              <div className="border-2 border-sq-black px-6 py-8 text-center font-sans text-[14px] text-sq-gray-600">
                No active subscriptions detected.
              </div>
            ) : (
              <SubTable subs={activeSubs} {...tableProps} />
            )}
          </div>

          {/* Past subscriptions */}
          {pastSubs.length > 0 && (
            <div>
              <h2 className="font-sans font-bold text-[13px] uppercase tracking-wider text-sq-gray-600 mb-3">
                Past Subscriptions
                <span className="ml-2 font-normal">({pastSubs.length})</span>
              </h2>
              <SubTable subs={pastSubs} {...tableProps} />
            </div>
          )}
        </>
      )}
    </PageShell>
  );
}

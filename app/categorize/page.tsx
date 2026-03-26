"use client";

export const dynamic = "force-dynamic";

import React, { useState, useEffect, useMemo, useCallback } from "react";
import { ChevronDown, ChevronRight, Check, Sparkles } from "lucide-react";
import { PageShell } from "@/components/layout/PageShell";
import { Button } from "@/components/ui";
import { createClient } from "@/lib/supabase/client";
import { formatCurrency, formatDate } from "@/lib/utils";
import type { Transaction, Category } from "@/lib/types";

// ── Payment providers whose brand names should not be used as the grouping key ──
const PAYMENT_PROVIDERS = [
  "zettle", "izettle", "paypal", "stripe", "square", "sumup",
  "klarna", "swish", "bambora", "nets",
];

function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9åäöéèüÅÄÖ\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Split a description into provider prefix + merchant part.
// e.g. "Zettle * Pizza Palace" → { provider: "zettle", merchant: "pizza palace" }
// e.g. "ICA Maxi Sthlm"       → { provider: "",        merchant: "ica maxi sthlm" }
function splitProviderMerchant(desc: string): { provider: string; merchant: string } {
  const n = normalize(desc);
  for (const p of PAYMENT_PROVIDERS) {
    // Match "provider *", "provider -", "provider  " etc.
    const re = new RegExp(`^${p}[\\s\\*\\-]+(.+)$`);
    const m = n.match(re);
    if (m && m[1].trim().length > 2) return { provider: p, merchant: m[1].trim() };
  }
  return { provider: "", merchant: n };
}

// Character-trigram Jaccard similarity [0..1]
function trigramSim(a: string, b: string): number {
  if (a === b) return 1;
  const tg = (s: string): Set<string> => {
    const set = new Set<string>();
    const p = ` ${s} `;
    for (let i = 0; i < p.length - 2; i++) set.add(p.slice(i, i + 3));
    return set;
  };
  const ta = tg(a);
  const tb = tg(b);
  if (!ta.size || !tb.size) return 0;
  let inter = 0;
  for (const t of Array.from(ta)) if (tb.has(t)) inter++;
  return inter / (ta.size + tb.size - inter);
}

interface TxGroup {
  displayName: string;      // Best display name (original case from first tx)
  provider: string;
  merchant: string;
  transactions: Transaction[];
  suggestedCategoryId: string | null;
  suggestedSubcategoryId: string | null;
}

function buildGroups(uncategorized: Transaction[], history: Transaction[]): TxGroup[] {
  // ── Build suggestion maps from categorized history ──────────────────────────
  const catFreq = new Map<string, Map<string, number>>();
  const subFreq = new Map<string, Map<string, number>>();
  for (const tx of history) {
    if (!tx.category_id) continue;
    const { merchant } = splitProviderMerchant(tx.description);
    if (!catFreq.has(merchant)) catFreq.set(merchant, new Map());
    catFreq.get(merchant)!.set(tx.category_id, (catFreq.get(merchant)!.get(tx.category_id) ?? 0) + 1);
    if (tx.subcategory_id) {
      if (!subFreq.has(merchant)) subFreq.set(merchant, new Map());
      subFreq.get(merchant)!.set(tx.subcategory_id, (subFreq.get(merchant)!.get(tx.subcategory_id) ?? 0) + 1);
    }
  }

  // ── Exact grouping by provider+merchant key ──────────────────────────────────
  const buckets = new Map<string, { provider: string; merchant: string; txs: Transaction[] }>();
  for (const tx of uncategorized) {
    const { provider, merchant } = splitProviderMerchant(tx.description);
    const key = `${provider}||${merchant}`;
    if (!buckets.has(key)) buckets.set(key, { provider, merchant, txs: [] });
    buckets.get(key)!.txs.push(tx);
  }

  // ── Fuzzy merge: similar merchant names with the same provider ───────────────
  // Only merge if similarity ≥ 0.68 AND same provider (prevents PayPal A merging with PayPal B)
  const arr = Array.from(buckets.values());
  const merged = new Uint8Array(arr.length); // 0 = keep, 1 = absorbed

  for (let i = 0; i < arr.length; i++) {
    if (merged[i]) continue;
    for (let j = i + 1; j < arr.length; j++) {
      if (merged[j]) continue;
      if (arr[i].provider !== arr[j].provider) continue;
      // If there's a provider, require tighter similarity (0.72) because merchant
      // names are shorter and false-positives are more likely.
      const threshold = arr[i].provider ? 0.72 : 0.68;
      if (trigramSim(arr[i].merchant, arr[j].merchant) < threshold) continue;

      // Merge smaller group into larger
      if (arr[i].txs.length >= arr[j].txs.length) {
        arr[i].txs.push(...arr[j].txs);
        merged[j] = 1;
      } else {
        arr[j].txs.push(...arr[i].txs);
        merged[i] = 1;
        break;
      }
    }
  }

  // ── Build result ─────────────────────────────────────────────────────────────
  const result: TxGroup[] = [];
  for (let i = 0; i < arr.length; i++) {
    if (merged[i]) continue;
    const { provider, merchant, txs } = arr[i];
    // Sort most-recent first; use that transaction's original description as display name
    const sorted = [...txs].sort((a, b) => b.date.localeCompare(a.date));

    // Suggestion: most-common category for this merchant in history
    let suggestedCategoryId: string | null = null;
    let suggestedSubcategoryId: string | null = null;
    const cm = catFreq.get(merchant);
    if (cm) {
      let best = 0;
      for (const [cid, cnt] of Array.from(cm.entries())) {
        if (cnt > best) { best = cnt; suggestedCategoryId = cid; }
      }
    }
    if (suggestedCategoryId) {
      const sm = subFreq.get(merchant);
      if (sm) {
        let best = 0;
        for (const [sid, cnt] of Array.from(sm.entries())) {
          if (cnt > best) { best = cnt; suggestedSubcategoryId = sid; }
        }
      }
    }

    result.push({
      displayName: sorted[0].description,
      provider,
      merchant,
      transactions: sorted,
      suggestedCategoryId,
      suggestedSubcategoryId,
    });
  }

  // Sort: groups with suggestions first, then by count desc
  return result.sort((a, b) => {
    const diff = (b.suggestedCategoryId ? 1 : 0) - (a.suggestedCategoryId ? 1 : 0);
    return diff !== 0 ? diff : b.transactions.length - a.transactions.length;
  });
}

interface GroupSelection {
  categoryId: string;
  subcategoryId: string;
  applied: boolean;
}

export default function CategorizePage() {
  const supabase = createClient();
  const [userName, setUserName] = useState("");
  const [displayCurrency, setDisplayCurrency] = useState("SEK");
  const [uncategorized, setUncategorized] = useState<Transaction[]>([]);
  const [history, setHistory] = useState<Transaction[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [selections, setSelections] = useState<Record<number, GroupSelection>>({});
  const [expanded, setExpanded] = useState<Record<number, boolean>>({});
  const [applying, setApplying] = useState<Record<number, boolean>>({});

  const loadData = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      setUserName(user.user_metadata?.name || user.email || "");
      const { data: profile } = await supabase
        .from("profiles").select("default_currency").eq("id", user.id).single();
      if (profile?.default_currency) setDisplayCurrency(profile.default_currency);
    }
    const [{ data: uncatData }, { data: histData }, { data: catData }] = await Promise.all([
      supabase.from("transactions").select("*")
        .is("category_id", null)
        .order("date", { ascending: false }),
      supabase.from("transactions").select("id, description, category_id, subcategory_id")
        .not("category_id", "is", null),
      supabase.from("categories").select("*").order("sort_order").order("name"),
    ]);
    if (uncatData) setUncategorized(uncatData);
    if (histData) setHistory(histData as Transaction[]);
    if (catData) setCategories(catData);
    setLoading(false);
  }, [supabase]);

  useEffect(() => { loadData(); }, [loadData]);

  const groups = useMemo(() => buildGroups(uncategorized, history), [uncategorized, history]);

  // Pre-populate selections from suggestions when groups change
  useEffect(() => {
    setSelections((prev) => {
      const next = { ...prev };
      groups.forEach((g, i) => {
        if (!next[i] && g.suggestedCategoryId) {
          next[i] = {
            categoryId: g.suggestedCategoryId,
            subcategoryId: g.suggestedSubcategoryId ?? "",
            applied: false,
          };
        } else if (!next[i]) {
          next[i] = { categoryId: "", subcategoryId: "", applied: false };
        }
      });
      return next;
    });
  }, [groups]);

  const topLevelCats = useMemo(
    () => categories.filter((c) => !c.parent_id && !c.is_archived),
    [categories]
  );

  const subsFor = useCallback(
    (categoryId: string) => categories.filter((c) => c.parent_id === categoryId && !c.is_archived),
    [categories]
  );

  const patchSelection = (idx: number, patch: Partial<GroupSelection>) => {
    setSelections((prev) => ({ ...prev, [idx]: { ...prev[idx], ...patch } }));
  };

  const handleApply = async (idx: number) => {
    const sel = selections[idx];
    if (!sel?.categoryId) return;
    const group = groups[idx];
    setApplying((p) => ({ ...p, [idx]: true }));
    const ids = group.transactions.map((t) => t.id);
    const { error } = await supabase.from("transactions").update({
      category_id: sel.categoryId,
      subcategory_id: sel.subcategoryId || null,
    }).in("id", ids);
    setApplying((p) => ({ ...p, [idx]: false }));
    if (!error) {
      patchSelection(idx, { applied: true });
      // Remove applied transactions from uncategorized list
      setUncategorized((prev) => prev.filter((t) => !ids.includes(t.id)));
    }
  };

  const suggestedCount = useMemo(
    () => groups.filter((g, i) => g.suggestedCategoryId && !selections[i]?.applied).length,
    [groups, selections]
  );

  if (loading) {
    return (
      <PageShell userName={userName}>
        <div className="text-center py-16 text-sq-gray-600 font-sans text-[14px]">Loading…</div>
      </PageShell>
    );
  }

  if (groups.length === 0) {
    return (
      <PageShell userName={userName}>
        <h1 className="font-sans font-extrabold text-[32px] text-sq-black uppercase tracking-tight mb-8">
          Categorize
        </h1>
        <div className="border-2 border-sq-black px-8 py-16 text-center font-sans text-sq-gray-600 text-[15px]">
          All transactions are categorized.
        </div>
      </PageShell>
    );
  }

  return (
    <PageShell userName={userName}>
      <div className="flex justify-between items-end mb-8">
        <h1 className="font-sans font-extrabold text-[32px] text-sq-black uppercase tracking-tight">
          Categorize
        </h1>
        <div className="flex items-center gap-4 text-[12px] font-sans text-sq-gray-600">
          <span>{groups.length} group{groups.length !== 1 ? "s" : ""}</span>
          {suggestedCount > 0 && (
            <span className="flex items-center gap-1 text-sq-blue font-semibold">
              <Sparkles className="w-3.5 h-3.5" />
              {suggestedCount} auto-suggested
            </span>
          )}
        </div>
      </div>

      <div className="space-y-3">
        {groups.map((group, idx) => {
          const sel = selections[idx] ?? { categoryId: "", subcategoryId: "", applied: false };
          const subs = subsFor(sel.categoryId);
          const hasSuggestion = !!group.suggestedCategoryId;
          const isSuggested = hasSuggestion && sel.categoryId === group.suggestedCategoryId;
          const isExpanded = !!expanded[idx];
          const isApplied = sel.applied;

          return (
            <div
              key={`${group.provider}||${group.merchant}`}
              className={`border-2 ${isApplied ? "border-sq-gray-100 opacity-50" : "border-sq-black"} transition-opacity`}
            >
              {/* Group header row */}
              <div className="grid grid-cols-12 gap-4 px-5 py-4 items-center bg-sq-white">
                {/* Expand toggle + name */}
                <div className="col-span-4 flex items-center gap-2 min-w-0">
                  <button
                    onClick={() => setExpanded((p) => ({ ...p, [idx]: !p[idx] }))}
                    className="flex-shrink-0 text-sq-gray-400 hover:text-sq-black"
                  >
                    {isExpanded
                      ? <ChevronDown className="w-4 h-4" />
                      : <ChevronRight className="w-4 h-4" />}
                  </button>
                  <div className="min-w-0">
                    <div className="font-sans font-semibold text-[14px] text-sq-black truncate">
                      {group.displayName}
                    </div>
                    {group.provider && (
                      <div className="font-sans text-[11px] text-sq-gray-400 uppercase tracking-wide">
                        via {group.provider}
                      </div>
                    )}
                  </div>
                  <span className="flex-shrink-0 font-mono text-[11px] text-sq-gray-400 bg-sq-gray-100 px-1.5 py-0.5">
                    {group.transactions.length}
                  </span>
                  {isSuggested && !isApplied && (
                    <Sparkles className="w-3.5 h-3.5 flex-shrink-0 text-sq-blue" />
                  )}
                </div>

                {/* Category picker */}
                <div className="col-span-3">
                  <select
                    value={sel.categoryId}
                    onChange={(e) => patchSelection(idx, { categoryId: e.target.value, subcategoryId: "", applied: false })}
                    disabled={isApplied}
                    className="w-full border border-sq-gray-100 px-2 py-1.5 font-sans text-[12px] outline-none focus:border-sq-black bg-sq-white"
                  >
                    <option value="">— Category —</option>
                    {(["expense", "income", "transfer"] as const).map((dir) => {
                      const g2 = topLevelCats.filter((c) => c.direction === dir);
                      if (!g2.length) return null;
                      return (
                        <optgroup key={dir} label={dir.charAt(0).toUpperCase() + dir.slice(1)}>
                          {g2.map((c) => (
                            <option key={c.id} value={c.id}>{c.name}</option>
                          ))}
                        </optgroup>
                      );
                    })}
                  </select>
                </div>

                {/* Subcategory picker */}
                <div className="col-span-3">
                  {subs.length > 0 ? (
                    <select
                      value={sel.subcategoryId}
                      onChange={(e) => patchSelection(idx, { subcategoryId: e.target.value, applied: false })}
                      disabled={isApplied}
                      className="w-full border border-sq-gray-100 px-2 py-1.5 font-sans text-[12px] outline-none focus:border-sq-black bg-sq-white"
                    >
                      <option value="">— Subcategory —</option>
                      {subs.map((c) => (
                        <option key={c.id} value={c.id}>{c.name}</option>
                      ))}
                    </select>
                  ) : (
                    <span className="font-sans text-[12px] text-sq-gray-400">—</span>
                  )}
                </div>

                {/* Apply button */}
                <div className="col-span-2 flex justify-end">
                  {isApplied ? (
                    <span className="flex items-center gap-1 font-sans text-[12px] text-green-600 font-semibold">
                      <Check className="w-3.5 h-3.5" /> Applied
                    </span>
                  ) : (
                    <Button
                      size="sm"
                      disabled={!sel.categoryId || applying[idx]}
                      onClick={() => handleApply(idx)}
                    >
                      {applying[idx] ? "Saving…" : `Apply to ${group.transactions.length}`}
                    </Button>
                  )}
                </div>
              </div>

              {/* Expanded transaction list */}
              {isExpanded && (
                <div className="border-t border-sq-gray-100 bg-sq-gray-100 px-6 py-3 space-y-1">
                  {group.transactions.map((tx) => (
                    <div key={tx.id} className="flex justify-between items-center py-1.5 border-b border-sq-gray-100 last:border-0">
                      <div className="flex items-center gap-4">
                        <span className="font-mono text-[12px] text-sq-gray-400">{formatDate(tx.date)}</span>
                        <span className="font-sans text-[13px] text-sq-black truncate max-w-[360px]">{tx.description}</span>
                      </div>
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
    </PageShell>
  );
}

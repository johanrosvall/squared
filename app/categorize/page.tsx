"use client";

export const dynamic = "force-dynamic";

import React, { useState, useEffect, useMemo } from "react";
import { ChevronDown, ChevronRight, Check } from "lucide-react";
import { PageShell } from "@/components/layout/PageShell";
import { Button, Card } from "@/components/ui";
import { createClient } from "@/lib/supabase/client";
import { formatCurrency, formatDate } from "@/lib/utils";
import type { Transaction, Category } from "@/lib/types";

const LS_RULES_KEY = "sq_auto_rules";

interface AutoRule {
  id: string;
  keyword: string;
  markShared: boolean;
  markInternalTransfer?: boolean;
  categoryId: string;
}

export default function CategorizePage() {
  const supabase = createClient();
  const [userName, setUserName] = useState("");
  const [displayCurrency, setDisplayCurrency] = useState("SEK");
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [selections, setSelections] = useState<Record<string, string>>({});
  const [expanded, setExpanded] = useState<string | null>(null);
  const [applying, setApplying] = useState<string | null>(null);
  const [applied, setApplied] = useState<Set<string>>(new Set());

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

      const [{ data: txs }, { data: cats }] = await Promise.all([
        supabase
          .from("transactions")
          .select("*")
          .is("category_id", null)
          .eq("transaction_type", "expense")
          .order("description"),
        supabase.from("categories").select("*").order("name"),
      ]);

      if (txs) setTransactions(txs);
      if (cats) setCategories(cats);
      setLoading(false);
    })();
  }, [supabase]);

  // Group uncategorized transactions by description
  const groups = useMemo(() => {
    const map = new Map<string, Transaction[]>();
    for (const tx of transactions) {
      const key = tx.description.trim();
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(tx);
    }
    return Array.from(map.entries())
      .map(([desc, txs]) => ({ description: desc, transactions: txs }))
      .sort((a, b) => b.transactions.length - a.transactions.length);
  }, [transactions]);

  const handleApply = async (description: string, txs: Transaction[]) => {
    const categoryId = selections[description];
    if (!categoryId) return;

    setApplying(description);

    // Bulk update all transactions in this group
    const ids = txs.map((t) => t.id);
    await supabase.from("transactions").update({ category_id: categoryId }).in("id", ids);

    // Save/update rule in localStorage
    let rules: AutoRule[] = [];
    try {
      const stored = localStorage.getItem(LS_RULES_KEY);
      if (stored) rules = JSON.parse(stored);
    } catch { /* ignore */ }

    const existingIdx = rules.findIndex(
      (r) => r.keyword.toLowerCase() === description.toLowerCase()
    );
    const rule: AutoRule = {
      id: existingIdx >= 0 ? rules[existingIdx].id : crypto.randomUUID(),
      keyword: description,
      markShared: existingIdx >= 0 ? rules[existingIdx].markShared : false,
      categoryId,
    };
    if (existingIdx >= 0) rules[existingIdx] = rule;
    else rules.push(rule);
    localStorage.setItem(LS_RULES_KEY, JSON.stringify(rules));

    setApplied((prev) => new Set(prev).add(description));
    setApplying(null);
  };

  const categoryName = (id: string) =>
    categories.find((c) => c.id === id)?.name ?? "";

  const visibleGroups = groups.filter((g) => !applied.has(g.description));

  return (
    <PageShell userName={userName}>
      <div className="flex justify-between items-end mb-8">
        <h1 className="font-sans font-extrabold text-[32px] text-sq-black uppercase tracking-tight">
          Bulk Categorize
        </h1>
        <div className="font-sans text-[13px] text-sq-gray-600">
          {visibleGroups.length} groups · {visibleGroups.reduce((s, g) => s + g.transactions.length, 0)} uncategorized
        </div>
      </div>

      {loading ? (
        <div className="text-center py-16 text-sq-gray-600 font-sans text-[14px]">Loading…</div>
      ) : categories.length === 0 ? (
        <Card className="text-center py-16">
          <p className="font-sans text-sq-gray-600 text-[15px] mb-4">
            No categories yet. Go to Settings to seed default categories first.
          </p>
          <a
            href="/settings"
            className="font-sans font-semibold text-[12px] uppercase tracking-wider bg-sq-black text-sq-white px-4 py-2 hover:bg-[#333] transition-colors"
          >
            Go to Settings
          </a>
        </Card>
      ) : visibleGroups.length === 0 ? (
        <Card className="text-center py-16">
          <p className="font-sans text-sq-gray-600 text-[15px]">
            All transactions are categorized!
          </p>
        </Card>
      ) : (
        <div className="border-2 border-sq-black">
          {/* Header */}
          <div className="grid grid-cols-12 gap-4 px-6 py-3 bg-sq-gray-100 border-b border-sq-black">
            <div className="col-span-4 sq-label-muted">Description</div>
            <div className="col-span-1 sq-label-muted">Count</div>
            <div className="col-span-3 sq-label-muted">Category</div>
            <div className="col-span-4 sq-label-muted"></div>
          </div>

          {visibleGroups.map((group) => (
            <div key={group.description}>
              <div className="grid grid-cols-12 gap-4 px-6 py-3 border-b border-sq-gray-100 items-center">
                {/* Description — click to expand */}
                <div
                  className="col-span-4 flex items-center gap-2 cursor-pointer"
                  onClick={() =>
                    setExpanded(expanded === group.description ? null : group.description)
                  }
                >
                  {expanded === group.description
                    ? <ChevronDown className="w-3.5 h-3.5 text-sq-gray-600 flex-shrink-0" />
                    : <ChevronRight className="w-3.5 h-3.5 text-sq-gray-600 flex-shrink-0" />
                  }
                  <span className="font-sans text-[13px] text-sq-black truncate">
                    {group.description}
                  </span>
                </div>

                <div className="col-span-1">
                  <span className="font-mono text-[13px] text-sq-gray-600">
                    {group.transactions.length}×
                  </span>
                </div>

                <div className="col-span-3">
                  <select
                    value={selections[group.description] || ""}
                    onChange={(e) =>
                      setSelections((prev) => ({ ...prev, [group.description]: e.target.value }))
                    }
                    className="w-full border border-sq-gray-400 px-2 py-1.5 font-sans text-[12px] outline-none focus:border-sq-black bg-white"
                  >
                    <option value="">Select category…</option>
                    {categories.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="col-span-4 flex justify-end">
                  <Button
                    size="sm"
                    onClick={() => handleApply(group.description, group.transactions)}
                    disabled={!selections[group.description] || applying === group.description}
                  >
                    <Check className="w-3 h-3" />
                    {applying === group.description ? "Applying…" : "Apply & Save Rule"}
                  </Button>
                </div>
              </div>

              {/* Expanded sample transactions */}
              {expanded === group.description && (
                <div className="bg-sq-gray-100 border-b border-sq-black px-8 py-3">
                  {selections[group.description] && (
                    <div className="font-sans text-[11px] text-sq-gray-600 mb-2">
                      Will save rule: <strong>{group.description}</strong> → {categoryName(selections[group.description])}
                    </div>
                  )}
                  {group.transactions.slice(0, 5).map((tx) => (
                    <div
                      key={tx.id}
                      className="flex justify-between py-1.5 border-b border-sq-gray-200 last:border-0 items-center"
                    >
                      <span className="font-mono text-[12px] text-sq-gray-600">
                        {formatDate(tx.date)}
                      </span>
                      <span
                        className={`font-mono text-[12px] font-bold ${
                          tx.amount < 0 ? "text-sq-green" : "text-sq-red"
                        }`}
                      >
                        {formatCurrency(Math.abs(tx.amount), tx.currency || displayCurrency)}
                      </span>
                    </div>
                  ))}
                  {group.transactions.length > 5 && (
                    <div className="font-sans text-[11px] text-sq-gray-400 mt-1 pt-1">
                      +{group.transactions.length - 5} more transactions
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </PageShell>
  );
}

"use client";

export const dynamic = "force-dynamic";

import React, { useState, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import {
  CreditCard,
  ArrowLeft,
  ChevronRight,
  Eye,
  List,
} from "lucide-react";
import Link from "next/link";
import { PageShell } from "@/components/layout/PageShell";
import { Card, Badge, Button } from "@/components/ui";
import { createClient } from "@/lib/supabase/client";
import { formatCurrency, formatDate, cn, pct } from "@/lib/utils";
import type { CreditCardBill, Transaction, Category } from "@/lib/types";

export default function CreditCardBillPage() {
  // This page would normally be at /transactions/cc-bill/[id]
  // For simplicity, using search params
  const supabase = createClient();
  const [userName, setUserName] = useState("");
  const [bills, setBills] = useState<(CreditCardBill & { charges: Transaction[] })[]>([]);
  const [selectedBillId, setSelectedBillId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"transfer" | "exploded">("transfer");

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) setUserName(user.user_metadata?.name || user.email || "");

      const { data: billData } = await supabase
        .from("credit_card_bills")
        .select("*")
        .order("statement_end_date", { ascending: false });

      if (billData) {
        const enriched = await Promise.all(
          billData.map(async (bill: CreditCardBill) => {
            const { data: charges } = await supabase
              .from("transactions")
              .select("*, category:categories(*)")
              .eq("account_id", bill.credit_card_account_id)
              .gte("date", bill.statement_start_date)
              .lte("date", bill.statement_end_date)
              .order("date", { ascending: false });
            return { ...bill, charges: charges || [] };
          })
        );
        setBills(enriched);
        if (enriched.length > 0) setSelectedBillId(enriched[0].id);
      }
    })();
  }, [supabase]);

  const bill = bills.find((b) => b.id === selectedBillId);

  // Category breakdown for exploded view
  const categoryBreakdown = new Map<string, { name: string; color: string; total: number }>();
  if (bill) {
    for (const tx of bill.charges) {
      const cat = tx.category as Category | undefined;
      const key = cat?.id || "uncategorized";
      const existing = categoryBreakdown.get(key) || { name: cat?.name || "Uncategorized", color: cat?.color || "#D4D4D4", total: 0 };
      existing.total += Math.abs(tx.amount);
      categoryBreakdown.set(key, existing);
    }
  }
  const catList = Array.from(categoryBreakdown.values()).sort((a, b) => b.total - a.total);
  const chargesTotal = bill ? bill.charges.reduce((s, t) => s + Math.abs(t.amount), 0) : 0;

  return (
    <PageShell userName={userName}>
      <div className="flex items-center gap-4 mb-8">
        <Link href="/transactions" className="text-sq-gray-600 hover:text-sq-black">
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <h1 className="font-sans font-extrabold text-[32px] text-sq-black uppercase tracking-tight">
          Credit Card Bills
        </h1>
      </div>

      {bills.length === 0 ? (
        <Card className="text-center py-16">
          <CreditCard className="w-12 h-12 text-sq-gray-400 mx-auto mb-4" />
          <p className="font-sans text-[16px] text-sq-gray-600 font-semibold mb-2">No credit card bills</p>
          <p className="font-sans text-[14px] text-sq-gray-400">
            Designate a payment as a CC bill from the Transactions page to see it here.
          </p>
        </Card>
      ) : (
        <div className="grid grid-cols-12 gap-6">
          {/* Bill list sidebar */}
          <div className="col-span-3 border-2 border-sq-black">
            <div className="bg-sq-gray-100 px-4 py-3 border-b border-sq-black sq-label-muted">Bills</div>
            {bills.map((b) => (
              <button
                key={b.id}
                onClick={() => { setSelectedBillId(b.id); setViewMode("transfer"); }}
                className={cn(
                  "w-full px-4 py-3 border-b border-sq-gray-100 text-left transition-colors",
                  selectedBillId === b.id ? "bg-sq-gray-100" : "hover:bg-sq-gray-100"
                )}
              >
                <div className="font-mono text-[14px] font-bold text-sq-black">
                  {formatCurrency(Number(b.total_amount))}
                </div>
                <div className="font-sans text-[11px] text-sq-gray-600 mt-1">
                  {formatDate(b.statement_start_date)} — {formatDate(b.statement_end_date)}
                </div>
                <div className="font-mono text-[11px] text-sq-gray-400 mt-1">
                  {b.charges.length} charges
                </div>
              </button>
            ))}
          </div>

          {/* Bill detail */}
          {bill && (
            <div className="col-span-9">
              {/* Header */}
              <Card className="mb-6">
                <div className="flex justify-between items-start">
                  <div>
                    <div className="sq-label-muted mb-1">Statement Period</div>
                    <div className="font-sans text-[16px] text-sq-black font-bold">
                      {formatDate(bill.statement_start_date)} — {formatDate(bill.statement_end_date)}
                    </div>
                    <div className="mt-3 sq-label-muted mb-1">Total Payment</div>
                    <div className="font-mono text-[28px] font-bold text-sq-black">
                      {formatCurrency(Number(bill.total_amount))}
                    </div>
                    <div className="font-mono text-[13px] text-sq-gray-600 mt-1">
                      {bill.charges.length} underlying transactions
                    </div>
                  </div>
                  <div className="flex border-2 border-sq-black">
                    <button
                      onClick={() => setViewMode("transfer")}
                      className={cn(
                        "px-4 py-2 font-sans font-semibold text-[12px] uppercase tracking-wider transition-colors",
                        viewMode === "transfer" ? "bg-sq-black text-sq-white" : "text-sq-gray-600"
                      )}
                    >
                      Transfer View
                    </button>
                    <button
                      onClick={() => setViewMode("exploded")}
                      className={cn(
                        "px-4 py-2 font-sans font-semibold text-[12px] uppercase tracking-wider transition-colors",
                        viewMode === "exploded" ? "bg-sq-black text-sq-white" : "text-sq-gray-600"
                      )}
                    >
                      Exploded View
                    </button>
                  </div>
                </div>
              </Card>

              {viewMode === "transfer" ? (
                <Card>
                  <div className="text-center py-8">
                    <CreditCard className="w-8 h-8 text-sq-gray-400 mx-auto mb-3" />
                    <p className="font-sans text-[14px] text-sq-gray-600 mb-4">
                      This payment appears as a single transfer from your checking account.
                    </p>
                    <Button variant="secondary" onClick={() => setViewMode("exploded")}>
                      <Eye className="w-4 h-4" /> View Individual Charges
                    </Button>
                  </div>
                </Card>
              ) : (
                <>
                  {/* Category breakdown */}
                  {catList.length > 0 && (
                    <div className="flex gap-3 mb-6 flex-wrap">
                      {catList.map((cat) => (
                        <div key={cat.name} className="border-2 border-sq-black px-4 py-2 flex items-center gap-2">
                          <div className="w-3 h-3 rounded-full" style={{ backgroundColor: cat.color }} />
                          <span className="font-sans text-[13px] text-sq-black font-semibold">{cat.name}:</span>
                          <span className="font-mono text-[13px] text-sq-black">{formatCurrency(cat.total)}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Charges table */}
                  <div className="border border-sq-black">
                    <div className="grid grid-cols-12 gap-4 px-6 py-3 bg-sq-gray-100 border-b border-sq-black">
                      <div className="col-span-2 sq-label-muted">Date</div>
                      <div className="col-span-5 sq-label-muted">Merchant</div>
                      <div className="col-span-3 sq-label-muted">Category</div>
                      <div className="col-span-2 text-right sq-label-muted">Amount</div>
                    </div>
                    {bill.charges.map((tx) => {
                      const cat = tx.category as Category | undefined;
                      return (
                        <div key={tx.id} className="grid grid-cols-12 gap-4 px-6 py-3 border-b border-sq-gray-100 items-center">
                          <div className="col-span-2 font-mono text-[13px] text-sq-gray-600">{formatDate(tx.date)}</div>
                          <div className="col-span-5 font-sans text-[14px] text-sq-black">{tx.description}</div>
                          <div className="col-span-3 flex items-center gap-1.5">
                            {cat ? (
                              <>
                                <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: cat.color || "#D4D4D4" }} />
                                <span className="font-sans text-[12px] text-sq-gray-600">{cat.name}</span>
                              </>
                            ) : (
                              <span className="font-sans text-[12px] text-sq-gray-400 italic">Uncategorized</span>
                            )}
                          </div>
                          <div className="col-span-2 text-right font-mono text-[14px] font-bold text-sq-black">
                            {formatCurrency(Math.abs(tx.amount))}
                          </div>
                        </div>
                      );
                    })}
                    {/* Total verification */}
                    <div className="grid grid-cols-12 gap-4 px-6 py-3 bg-sq-gray-100 border-t border-sq-black">
                      <div className="col-span-10 font-sans font-bold text-[12px] uppercase tracking-widest text-sq-gray-600">
                        Total ({bill.charges.length} charges)
                      </div>
                      <div className={cn(
                        "col-span-2 text-right font-mono text-[14px] font-bold",
                        Math.abs(chargesTotal - Number(bill.total_amount)) > 0.01 ? "text-sq-red" : "text-sq-black"
                      )}>
                        {formatCurrency(chargesTotal)}
                      </div>
                    </div>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      )}
    </PageShell>
  );
}

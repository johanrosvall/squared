"use client";

export const dynamic = "force-dynamic";

import React, { useState, useEffect } from "react";
import {
  ArrowUpRight,
  ArrowDownRight,
  Scale,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import { PageShell } from "@/components/layout/PageShell";
import { Card, Button } from "@/components/ui";
import { createClient } from "@/lib/supabase/client";
import { formatCurrency, formatDate, cn } from "@/lib/utils";
import type { Transaction, SettlementGroup } from "@/lib/types";

export default function SettlePage() {
  const supabase = createClient();
  const [userName, setUserName] = useState("");
  const [dateRange, setDateRange] = useState<"month" | "quarter" | "custom">("month");
  const [userPaidTotal, setUserPaidTotal] = useState(0);
  const [partnerPaidTotal, setPartnerPaidTotal] = useState(0);
  const [transferredToUser, setTransferredToUser] = useState(0);
  const [transferredToShared, setTransferredToShared] = useState(0);
  const [unsettledExpenses, setUnsettledExpenses] = useState<Transaction[]>([]);
  const [settlements, setSettlements] = useState<SettlementGroup[]>([]);
  const [showUnsettled, setShowUnsettled] = useState(false);
  const [showHistory, setShowHistory] = useState(false);

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) setUserName(user.user_metadata?.name || user.email || "");

      // Calculate date range
      const now = new Date();
      let dateFrom: string;
      if (dateRange === "month") {
        dateFrom = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
      } else {
        const qMonth = Math.floor(now.getMonth() / 3) * 3;
        dateFrom = `${now.getFullYear()}-${String(qMonth + 1).padStart(2, "0")}-01`;
      }

      // User's shared expenses (from private + CC accounts)
      const { data: userShared } = await supabase
        .from("transactions")
        .select("*, account:accounts(*)")
        .eq("is_shared", true)
        .gte("date", dateFrom)
        .neq("transaction_type", "transfer");
      if (userShared) {
        const privateExpenses = userShared.filter(
          (t) => (t.account as any)?.type !== "shared"
        );
        const sharedExpenses = userShared.filter(
          (t) => (t.account as any)?.type === "shared"
        );
        setUserPaidTotal(privateExpenses.reduce((s, t) => s + Math.abs(Number(t.amount)), 0));
        setPartnerPaidTotal(sharedExpenses.reduce((s, t) => s + Math.abs(Number(t.amount)), 0));
      }

      // Unsettled shared expenses
      const { data: unsettled } = await supabase
        .from("transactions")
        .select("*, account:accounts(*)")
        .eq("is_shared", true)
        .in("reimbursement_status", ["none", "pending", "partial"])
        .gte("date", dateFrom)
        .order("date", { ascending: false });
      if (unsettled) setUnsettledExpenses(unsettled);

      // Settlement history
      const { data: groups } = await supabase
        .from("settlement_groups")
        .select("*")
        .gte("settlement_date", dateFrom)
        .order("settlement_date", { ascending: false });
      if (groups) setSettlements(groups);
    })();
  }, [supabase, dateRange]);

  const netBalance = (userPaidTotal * 0.5) - (partnerPaidTotal * 0.5) - transferredToUser + transferredToShared;
  const youAreOwed = netBalance > 0;

  return (
    <PageShell userName={userName} unsettledBalance={-Math.abs(netBalance)}>
      <div className="flex justify-between items-center mb-8">
        <h1 className="font-sans font-extrabold text-[32px] text-sq-black uppercase tracking-tight">
          Settled Up
        </h1>
        <div className="flex border-2 border-sq-black">
          {(["month", "quarter"] as const).map((r) => (
            <button
              key={r}
              onClick={() => setDateRange(r)}
              className={cn(
                "px-4 py-2 font-sans font-semibold text-[12px] uppercase tracking-wider transition-colors",
                dateRange === r ? "bg-sq-black text-sq-white" : "text-sq-gray-600 hover:text-sq-black"
              )}
            >
              {r === "month" ? "This Month" : "This Quarter"}
            </button>
          ))}
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-4 gap-6 mb-8">
        <Card>
          <div className="sq-label-muted mb-2">You Paid For</div>
          <div className="font-mono text-[28px] font-bold text-sq-black">{formatCurrency(userPaidTotal)}</div>
          <div className="font-sans text-[12px] text-sq-gray-600 mt-1">Shared expenses from your accounts</div>
        </Card>
        <Card>
          <div className="sq-label-muted mb-2">Partner Paid For</div>
          <div className="font-mono text-[28px] font-bold text-sq-black">{formatCurrency(partnerPaidTotal)}</div>
          <div className="font-sans text-[12px] text-sq-gray-600 mt-1">Shared expenses from joint account</div>
        </Card>
        <Card>
          <div className="sq-label-muted mb-2">Transferred To You</div>
          <div className="font-mono text-[28px] font-bold text-sq-green">{formatCurrency(transferredToUser)}</div>
        </Card>
        <Card>
          <div className="sq-label-muted mb-2">Transferred To Shared</div>
          <div className="font-mono text-[28px] font-bold text-sq-red">{formatCurrency(transferredToShared)}</div>
        </Card>
      </div>

      {/* Net balance hero */}
      <Card className={cn("text-center py-8 mb-10", youAreOwed ? "border-sq-green" : "border-sq-red")}>
        <div className="flex items-center justify-center gap-3 mb-2">
          {youAreOwed ? (
            <ArrowDownRight className="w-6 h-6 text-sq-green" />
          ) : (
            <ArrowUpRight className="w-6 h-6 text-sq-red" />
          )}
          <span className="font-sans font-bold text-[16px] uppercase tracking-widest text-sq-gray-600">
            {youAreOwed ? "You are owed" : "You owe"}
          </span>
        </div>
        <div className={cn("font-mono text-[48px] font-bold", youAreOwed ? "text-sq-green" : "text-sq-red")}>
          {formatCurrency(Math.abs(netBalance))}
        </div>
      </Card>

      {/* Drill-downs */}
      <div className="space-y-4">
        {/* Unsettled expenses */}
        <div className="border-2 border-sq-black">
          <button
            onClick={() => setShowUnsettled(!showUnsettled)}
            className="w-full flex items-center justify-between px-6 py-4 hover:bg-sq-gray-100 transition-colors"
          >
            <span className="font-sans font-bold text-[14px] uppercase tracking-wider text-sq-black">
              Unsettled Shared Expenses ({unsettledExpenses.length})
            </span>
            {showUnsettled ? <ChevronDown className="w-5 h-5" /> : <ChevronRight className="w-5 h-5" />}
          </button>
          {showUnsettled && (
            <div className="border-t border-sq-black">
              {unsettledExpenses.length === 0 ? (
                <div className="px-6 py-6 text-center text-sq-gray-600 font-sans text-[14px]">
                  All caught up! No unsettled expenses.
                </div>
              ) : (
                unsettledExpenses.map((tx) => (
                  <div key={tx.id} className="grid grid-cols-12 gap-4 px-6 py-3 border-b border-sq-gray-100 items-center">
                    <div className="col-span-2 font-mono text-[13px] text-sq-gray-600">{formatDate(tx.date)}</div>
                    <div className="col-span-6 font-sans text-[14px] text-sq-black">{tx.description}</div>
                    <div className="col-span-2 font-sans text-[12px] text-sq-gray-600 capitalize">{tx.reimbursement_status}</div>
                    <div className="col-span-2 text-right font-mono text-[14px] font-bold text-sq-black">
                      {formatCurrency(Math.abs(tx.amount))}
                    </div>
                  </div>
                ))
              )}
            </div>
          )}
        </div>

        {/* Settlement history */}
        <div className="border-2 border-sq-black">
          <button
            onClick={() => setShowHistory(!showHistory)}
            className="w-full flex items-center justify-between px-6 py-4 hover:bg-sq-gray-100 transition-colors"
          >
            <span className="font-sans font-bold text-[14px] uppercase tracking-wider text-sq-black">
              Settlement History ({settlements.length})
            </span>
            {showHistory ? <ChevronDown className="w-5 h-5" /> : <ChevronRight className="w-5 h-5" />}
          </button>
          {showHistory && (
            <div className="border-t border-sq-black">
              {settlements.length === 0 ? (
                <div className="px-6 py-6 text-center text-sq-gray-600 font-sans text-[14px]">
                  No settlements yet.
                </div>
              ) : (
                settlements.map((sg) => (
                  <div key={sg.id} className="grid grid-cols-12 gap-4 px-6 py-3 border-b border-sq-gray-100 items-center">
                    <div className="col-span-3 font-mono text-[13px] text-sq-gray-600">{formatDate(sg.settlement_date)}</div>
                    <div className="col-span-4 font-sans text-[14px] text-sq-black capitalize">
                      {sg.direction.replace("_", " ")}
                    </div>
                    <div className="col-span-3 font-sans text-[12px] text-sq-gray-600">{sg.note || "—"}</div>
                    <div className="col-span-2 text-right font-mono text-[14px] font-bold text-sq-green">
                      {formatCurrency(Number(sg.total_amount))}
                    </div>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      </div>
    </PageShell>
  );
}

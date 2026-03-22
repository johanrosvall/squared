"use client";

export const dynamic = "force-dynamic";

import React, { useState, useEffect, useCallback } from "react";
import {
  Heart,
  ArrowRight,
  ArrowLeft,
  CheckCircle,
  Users,
  AlertTriangle,
} from "lucide-react";
import { PageShell } from "@/components/layout/PageShell";
import { Button, Card, Badge } from "@/components/ui";
import { createClient } from "@/lib/supabase/client";
import { formatCurrency, formatDate, cn } from "@/lib/utils";
import type { Transaction, Account } from "@/lib/types";

export default function ReconcilePage() {
  const supabase = createClient();
  const [userName, setUserName] = useState("");
  const [expenses, setExpenses] = useState<Transaction[]>([]);
  const [transfers, setTransfers] = useState<Transaction[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);

  // Selection state
  const [selectedTransferId, setSelectedTransferId] = useState<string | null>(null);
  const [selectedExpenseIds, setSelectedExpenseIds] = useState<string[]>([]);
  const [allocations, setAllocations] = useState<Record<string, number>>({});
  const [note, setNote] = useState("");
  const [settling, setSettling] = useState(false);
  const [showConfirmation, setShowConfirmation] = useState(false);

  const fetchData = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (user) setUserName(user.user_metadata?.name || user.email || "");

    const { data: accts } = await supabase.from("accounts").select("*").eq("is_active", true);
    if (accts) setAccounts(accts);

    // Unreimbursed shared expenses
    const { data: exps } = await supabase
      .from("transactions")
      .select("*, account:accounts!account_id(*)")
      .eq("is_shared", true)
      .in("reimbursement_status", ["none", "pending", "partial"])
      .order("date", { ascending: false });
    if (exps) setExpenses(exps);

    // Unallocated transfers
    const { data: trans } = await supabase
      .from("transactions")
      .select("*, account:accounts!account_id(*)")
      .in("transaction_type", ["transfer", "partner_transfer"])
      .order("date", { ascending: false });
    if (trans) setTransfers(trans);
  }, [supabase]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const selectedTransfer = transfers.find((t) => t.id === selectedTransferId);
  const selectedExpenses = expenses.filter((e) => selectedExpenseIds.includes(e.id));
  const totalAllocated = Object.values(allocations).reduce((s, v) => s + v, 0);
  const transferAmount = selectedTransfer ? Math.abs(selectedTransfer.amount) : 0;
  const overAllocated = totalAllocated > transferAmount;

  const partnerTransfers = transfers.filter((t) => t.is_partner_transfer);
  const otherTransfers = transfers.filter((t) => !t.is_partner_transfer);

  const toggleExpense = (id: string) => {
    if (selectedExpenseIds.includes(id)) {
      setSelectedExpenseIds((ids) => ids.filter((x) => x !== id));
      setAllocations((a) => {
        const copy = { ...a };
        delete copy[id];
        return copy;
      });
    } else {
      const exp = expenses.find((e) => e.id === id);
      setSelectedExpenseIds((ids) => [...ids, id]);
      if (exp) {
        setAllocations((a) => ({ ...a, [id]: Math.abs(exp.amount) }));
      }
    }
  };

  const handleSettle = async () => {
    if (!selectedTransfer || selectedExpenseIds.length === 0) return;
    setSettling(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    // Determine direction
    const account = selectedTransfer.account as Account | undefined;
    const direction = account?.type === "shared" ? "from_shared" : "to_shared";

    // Create settlement group
    const { data: group } = await supabase
      .from("settlement_groups")
      .insert({
        user_id: user.id,
        transfer_transaction_id: selectedTransfer.id,
        total_amount: totalAllocated,
        direction,
        settlement_date: new Date().toISOString().split("T")[0],
        note: note || null,
      })
      .select()
      .single();

    if (group) {
      // Create allocations
      for (const expId of selectedExpenseIds) {
        const amount = allocations[expId] || 0;
        await supabase.from("reimbursement_allocations").insert({
          settlement_group_id: group.id,
          expense_transaction_id: expId,
          allocated_amount: amount,
        });

        // Update expense reimbursement status
        const exp = expenses.find((e) => e.id === expId);
        const expAmount = exp ? Math.abs(exp.amount) : 0;
        const status = amount >= expAmount ? "full" : "partial";
        await supabase
          .from("transactions")
          .update({ reimbursement_status: status })
          .eq("id", expId);
      }
    }

    setSettling(false);
    setShowConfirmation(true);
    setTimeout(() => {
      setShowConfirmation(false);
      setSelectedTransferId(null);
      setSelectedExpenseIds([]);
      setAllocations({});
      setNote("");
      fetchData();
    }, 2500);
  };

  // ─── Post-Settlement Confirmation ────────────
  if (showConfirmation) {
    return (
      <PageShell userName={userName}>
        <div className="flex items-center justify-center min-h-[60vh]">
          <Card className="text-center py-12 px-16">
            <CheckCircle className="w-16 h-16 text-sq-green mx-auto mb-4" />
            <h3 className="font-sans font-extrabold text-[24px] uppercase tracking-tight text-sq-black mb-2">
              Settlement Created
            </h3>
            <p className="font-mono text-[20px] text-sq-green font-bold">
              {formatCurrency(totalAllocated)} allocated
            </p>
            <p className="font-sans text-[14px] text-sq-gray-600 mt-2">
              {selectedExpenseIds.length} expense{selectedExpenseIds.length !== 1 ? "s" : ""} matched
            </p>
          </Card>
        </div>
      </PageShell>
    );
  }

  return (
    <PageShell userName={userName}>
      <h1 className="font-sans font-extrabold text-[32px] text-sq-black uppercase tracking-tight mb-8">
        Reconcile
      </h1>

      <div className="grid grid-cols-12 gap-6 -mx-12 px-6" style={{ minHeight: "70vh" }}>
        {/* ─── Left: Expenses ─────────────────── */}
        <div className="col-span-4 border-2 border-sq-black flex flex-col">
          <div className="bg-sq-gray-100 px-4 py-3 border-b border-sq-black flex items-center justify-between">
            <span className="font-sans font-bold text-[13px] uppercase tracking-wider text-sq-black">
              Unreimbursed Expenses
            </span>
            <span className="font-mono text-[12px] text-sq-gray-600">{expenses.length}</span>
          </div>
          {selectedExpenseIds.length > 0 && (
            <div className="bg-amber-50 px-4 py-2 border-b border-amber-200 flex justify-between items-center">
              <span className="font-sans text-[12px] text-amber-700 font-semibold">
                {selectedExpenseIds.length} selected
              </span>
              <span className="font-mono text-[13px] text-amber-700 font-bold">
                {formatCurrency(selectedExpenses.reduce((s, e) => s + Math.abs(e.amount), 0))}
              </span>
            </div>
          )}
          <div className="flex-1 overflow-y-auto">
            {expenses.length === 0 ? (
              <div className="px-4 py-8 text-center text-sq-gray-600 font-sans text-[13px]">
                No unreimbursed shared expenses.
              </div>
            ) : (
              expenses.map((exp) => {
                const isSelected = selectedExpenseIds.includes(exp.id);
                return (
                  <div
                    key={exp.id}
                    onClick={() => toggleExpense(exp.id)}
                    className={cn(
                      "px-4 py-3 border-b border-sq-gray-100 cursor-pointer transition-colors",
                      isSelected ? "bg-amber-50 border-l-4 border-l-amber-500" : "hover:bg-sq-gray-100"
                    )}
                  >
                    <div className="flex justify-between items-start">
                      <div className="flex-1 min-w-0">
                        <div className="font-sans text-[13px] text-sq-black truncate">{exp.description}</div>
                        <div className="font-mono text-[11px] text-sq-gray-600 mt-1">{formatDate(exp.date)}</div>
                      </div>
                      <div className="font-mono text-[14px] font-bold text-sq-black ml-3">
                        {formatCurrency(Math.abs(exp.amount))}
                      </div>
                    </div>
                    {exp.reimbursement_status === "partial" && (
                      <Badge variant="shared" className="mt-1">Partial</Badge>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* ─── Center: Settlement Composer ─────── */}
        <div className="col-span-4 border-2 border-sq-black flex flex-col">
          <div className="bg-sq-gray-100 px-4 py-3 border-b border-sq-black">
            <span className="font-sans font-bold text-[13px] uppercase tracking-wider text-sq-black">
              Settlement Composer
            </span>
          </div>
          <div className="flex-1 p-4 overflow-y-auto">
            {!selectedTransfer ? (
              <div className="flex items-center justify-center h-full text-center">
                <div>
                  <ArrowRight className="w-8 h-8 text-sq-gray-400 mx-auto mb-3" />
                  <p className="font-sans text-[14px] text-sq-gray-600">
                    Select a transfer from the right panel to begin
                  </p>
                </div>
              </div>
            ) : (
              <div>
                {/* Selected transfer */}
                <div className={cn(
                  "border-2 p-4 mb-6",
                  selectedTransfer.is_partner_transfer ? "border-sq-purple bg-purple-50" : "border-sq-black"
                )}>
                  <div className="flex items-center gap-2 mb-2">
                    {selectedTransfer.is_partner_transfer && (
                      <Badge variant="partner" icon={<Heart className="w-3 h-3" />}>Partner</Badge>
                    )}
                    <span className="font-sans font-bold text-[13px] text-sq-black uppercase tracking-wider">
                      Transfer
                    </span>
                  </div>
                  <div className="font-sans text-[14px] text-sq-black">{selectedTransfer.description}</div>
                  <div className="font-mono text-[20px] font-bold text-sq-black mt-1">
                    {formatCurrency(Math.abs(selectedTransfer.amount))}
                  </div>
                  <div className="font-mono text-[12px] text-sq-gray-600 mt-1">{formatDate(selectedTransfer.date)}</div>
                </div>

                {/* Selected expenses allocations */}
                {selectedExpenses.length === 0 ? (
                  <div className="text-center py-8">
                    <Users className="w-6 h-6 text-sq-gray-400 mx-auto mb-2" />
                    <p className="font-sans text-[13px] text-sq-gray-600">
                      Select expenses from the left panel
                    </p>
                  </div>
                ) : (
                  <>
                    <div className="sq-label-muted mb-3">Allocations</div>
                    {selectedExpenses.map((exp) => (
                      <div key={exp.id} className="flex items-center gap-3 mb-3">
                        <div className="flex-1 min-w-0">
                          <div className="font-sans text-[12px] text-sq-black truncate">{exp.description}</div>
                        </div>
                        <input
                          type="number"
                          step="0.01"
                          value={allocations[exp.id] || ""}
                          onChange={(e) => setAllocations({ ...allocations, [exp.id]: parseFloat(e.target.value) || 0 })}
                          className="w-28 border-2 border-sq-black px-2 py-1 font-mono text-[13px] text-right outline-none focus:border-sq-blue"
                        />
                      </div>
                    ))}

                    {/* Totals */}
                    <div className="border-t-2 border-sq-black mt-4 pt-4">
                      <div className="flex justify-between mb-1">
                        <span className="sq-label-muted">Transfer Amount</span>
                        <span className="font-mono text-[14px] font-bold">{formatCurrency(transferAmount)}</span>
                      </div>
                      <div className="flex justify-between mb-1">
                        <span className="sq-label-muted">Allocated</span>
                        <span className={cn("font-mono text-[14px] font-bold", overAllocated ? "text-sq-red" : "text-sq-black")}>
                          {formatCurrency(totalAllocated)}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="sq-label-muted">Remaining</span>
                        <span className="font-mono text-[14px] font-bold text-sq-gray-600">
                          {formatCurrency(transferAmount - totalAllocated)}
                        </span>
                      </div>
                    </div>

                    {overAllocated && (
                      <div className="mt-4 border-2 border-sq-red bg-red-50 px-4 py-2 flex items-center gap-2">
                        <AlertTriangle className="w-4 h-4 text-sq-red" />
                        <span className="font-sans text-[12px] text-sq-red font-semibold">
                          Allocation exceeds transfer amount
                        </span>
                      </div>
                    )}

                    {/* Note + Confirm */}
                    <div className="mt-4">
                      <textarea
                        value={note}
                        onChange={(e) => setNote(e.target.value)}
                        placeholder="Settlement note (optional)"
                        rows={2}
                        className="w-full border-2 border-sq-black px-3 py-2 font-sans text-[13px] outline-none focus:border-sq-blue resize-none mb-4"
                      />
                      <Button
                        onClick={handleSettle}
                        disabled={settling || overAllocated || totalAllocated === 0}
                        className="w-full"
                      >
                        {settling ? "Creating Settlement…" : "Confirm Settlement"}
                      </Button>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        </div>

        {/* ─── Right: Transfers ───────────────── */}
        <div className="col-span-4 border-2 border-sq-black flex flex-col">
          <div className="bg-sq-gray-100 px-4 py-3 border-b border-sq-black flex items-center justify-between">
            <span className="font-sans font-bold text-[13px] uppercase tracking-wider text-sq-black">
              Unallocated Transfers
            </span>
            <span className="font-mono text-[12px] text-sq-gray-600">{transfers.length}</span>
          </div>
          <div className="flex-1 overflow-y-auto">
            {/* Partner transfers section */}
            {partnerTransfers.length > 0 && (
              <>
                <div className="bg-purple-50 px-4 py-2 border-b border-sq-purple flex items-center gap-2">
                  <Heart className="w-3.5 h-3.5 text-sq-purple" />
                  <span className="font-sans font-bold text-[11px] uppercase tracking-widest text-sq-purple">
                    Partner Transfers
                  </span>
                </div>
                {partnerTransfers.map((t) => renderTransferRow(t))}
              </>
            )}
            {/* Other transfers */}
            {otherTransfers.length > 0 && (
              <>
                <div className="bg-sq-gray-100 px-4 py-2 border-b border-sq-gray-400">
                  <span className="font-sans font-bold text-[11px] uppercase tracking-widest text-sq-gray-600">
                    Other Transfers
                  </span>
                </div>
                {otherTransfers.map((t) => renderTransferRow(t))}
              </>
            )}
            {transfers.length === 0 && (
              <div className="px-4 py-8 text-center text-sq-gray-600 font-sans text-[13px]">
                No unallocated transfers found.
              </div>
            )}
          </div>
        </div>
      </div>
    </PageShell>
  );

  function renderTransferRow(t: Transaction) {
    const isSelected = selectedTransferId === t.id;
    const isPartner = t.is_partner_transfer;
    return (
      <div
        key={t.id}
        onClick={() => setSelectedTransferId(isSelected ? null : t.id)}
        className={cn(
          "px-4 py-3 border-b border-sq-gray-100 cursor-pointer transition-colors",
          isSelected && isPartner && "bg-purple-100 border-l-4 border-l-sq-purple",
          isSelected && !isPartner && "bg-sq-gray-100 border-l-4 border-l-sq-black",
          !isSelected && isPartner && "hover:bg-purple-50",
          !isSelected && !isPartner && "hover:bg-sq-gray-100"
        )}
      >
        <div className="flex justify-between items-start">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-sans text-[13px] text-sq-black truncate">{t.description}</span>
              {isPartner && (
                <Badge variant="partner" icon={<Heart className="w-3 h-3" />}>Partner</Badge>
              )}
            </div>
            <div className="font-mono text-[11px] text-sq-gray-600 mt-1">{formatDate(t.date)}</div>
          </div>
          <div className={cn(
            "font-mono text-[14px] font-bold ml-3",
            isPartner ? "text-sq-purple" : "text-sq-black"
          )}>
            {formatCurrency(Math.abs(t.amount))}
          </div>
        </div>
      </div>
    );
  }
}

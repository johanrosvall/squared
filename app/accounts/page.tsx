"use client";

export const dynamic = "force-dynamic";

import React, { useState, useEffect, useCallback } from "react";
import {
  Plus,
  Landmark,
  CreditCard,
  Users,
  PiggyBank,
  MoreVertical,
  History,
  Scale,
  ArrowLeft,
  AlertTriangle,
  Trash2,
} from "lucide-react";
import { PageShell } from "@/components/layout/PageShell";
import { Button, Card, Input, Select } from "@/components/ui";
import { createClient } from "@/lib/supabase/client";
import { formatCurrency, formatDate } from "@/lib/utils";
import type { Account, AccountType, ImportBatch } from "@/lib/types";

const accountTypeIcon: Record<string, React.ReactNode> = {
  checking: <Landmark className="w-6 h-6 text-sq-black" />,
  savings: <PiggyBank className="w-6 h-6 text-sq-black" />,
  credit_card: <CreditCard className="w-6 h-6 text-sq-black" />,
  shared: <Users className="w-6 h-6 text-sq-black" />,
  other: <Landmark className="w-6 h-6 text-sq-black" />,
};

type ViewState =
  | { mode: "gallery" }
  | { mode: "create" }
  | { mode: "history"; accountId: string; accountName: string }
  | { mode: "reconcile"; accountId: string; accountName: string };

export default function AccountsPage() {
  const supabase = createClient();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [view, setView] = useState<ViewState>({ mode: "gallery" });
  const [userName, setUserName] = useState("");

  // Create form state
  const [newName, setNewName] = useState("");
  const [newType, setNewType] = useState<AccountType>("checking");
  const [newCurrency, setNewCurrency] = useState("USD");
  const [creating, setCreating] = useState(false);

  // Import history state
  const [batches, setBatches] = useState<ImportBatch[]>([]);

  // Reconciliation state
  const [actualBalance, setActualBalance] = useState("");
  const [calculatedBalance, setCalculatedBalance] = useState(0);
  const [txCount, setTxCount] = useState(0);

  const fetchAccounts = useCallback(async () => {
    const { data } = await supabase
      .from("accounts")
      .select("*")
      .eq("is_active", true)
      .order("created_at");
    if (data) setAccounts(data);
  }, [supabase]);

  useEffect(() => {
    fetchAccounts();
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user) setUserName(user.user_metadata?.name || user.email || "");
    });
  }, [fetchAccounts, supabase]);

  const handleCreate = async () => {
    if (!newName.trim()) return;
    setCreating(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    await supabase.from("accounts").insert({
      user_id: user.id,
      name: newName.trim(),
      type: newType,
      currency: newCurrency,
    });
    setNewName("");
    setNewType("checking");
    setCreating(false);
    await fetchAccounts();
    setView({ mode: "gallery" });
  };

  const loadHistory = async (accountId: string) => {
    const { data } = await supabase
      .from("import_batches")
      .select("*")
      .eq("account_id", accountId)
      .order("import_date", { ascending: false });
    if (data) setBatches(data);
  };

  const loadReconciliation = async (accountId: string) => {
    const { data } = await supabase
      .from("transactions")
      .select("amount")
      .eq("account_id", accountId);
    if (data) {
      const sum = data.reduce((acc, t) => acc + Number(t.amount), 0);
      setCalculatedBalance(sum);
      setTxCount(data.length);
    }
  };

  // ─── Gallery View ────────────────────────────
  const renderGallery = () => (
    <div>
      <div className="flex justify-between items-end mb-8">
        <h2 className="font-sans font-extrabold text-[32px] text-sq-black uppercase tracking-tight">
          Accounts
        </h2>
        <Button onClick={() => setView({ mode: "create" })}>
          <Plus className="w-4 h-4" />
          Add Account
        </Button>
      </div>

      {accounts.length === 0 ? (
        <Card className="text-center py-16">
          <p className="font-sans text-sq-gray-600 text-[15px] mb-4">
            No accounts yet. Create your first account to get started.
          </p>
          <Button onClick={() => setView({ mode: "create" })}>
            <Plus className="w-4 h-4" />
            Add Account
          </Button>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {accounts.map((acct) => (
            <AccountCard
              key={acct.id}
              account={acct}
              onHistory={() => {
                loadHistory(acct.id);
                setView({ mode: "history", accountId: acct.id, accountName: acct.name });
              }}
              onReconcile={() => {
                loadReconciliation(acct.id);
                setActualBalance("");
                setView({ mode: "reconcile", accountId: acct.id, accountName: acct.name });
              }}
            />
          ))}
        </div>
      )}
    </div>
  );

  // ─── Create Account View ─────────────────────
  const renderCreate = () => (
    <div className="max-w-2xl">
      <h2 className="font-sans font-extrabold text-[32px] text-sq-black uppercase tracking-tight mb-8">
        Create Account
      </h2>
      <Card>
        <Input
          label="Account Name"
          type="text"
          placeholder="e.g. Chase Personal Checking"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
        />
        <div className="mb-6">
          <label className="block font-sans font-semibold text-[12px] uppercase tracking-widest text-sq-black mb-2">
            Account Type
          </label>
          <div className="flex gap-4">
            {(["checking", "credit_card", "shared", "savings", "other"] as AccountType[]).map((t) => (
              <button
                key={t}
                onClick={() => setNewType(t)}
                className={`flex-1 border-2 border-sq-black py-3 font-sans font-semibold text-[13px] uppercase tracking-wider transition-colors ${
                  newType === t
                    ? "bg-sq-black text-sq-white"
                    : "text-sq-black hover:bg-sq-gray-100"
                }`}
              >
                {t.replace("_", " ")}
              </button>
            ))}
          </div>
        </div>
        <Select
          label="Currency"
          value={newCurrency}
          onChange={(e) => setNewCurrency(e.target.value)}
          options={[
            { value: "USD", label: "USD ($)" },
            { value: "EUR", label: "EUR (€)" },
            { value: "GBP", label: "GBP (£)" },
            { value: "SEK", label: "SEK (kr)" },
          ]}
        />
        <div className="flex justify-end gap-4 mt-2">
          <Button variant="ghost" onClick={() => setView({ mode: "gallery" })}>
            Cancel
          </Button>
          <Button onClick={handleCreate} disabled={creating || !newName.trim()}>
            {creating ? "Creating…" : "Create Account"}
          </Button>
        </div>
      </Card>
    </div>
  );

  // ─── Import History View ─────────────────────
  const renderHistory = () => {
    if (view.mode !== "history") return null;
    return (
      <div>
        <div className="flex items-center gap-4 mb-8">
          <button onClick={() => setView({ mode: "gallery" })} className="text-sq-gray-600 hover:text-sq-black">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <h2 className="font-sans font-extrabold text-[32px] text-sq-black uppercase tracking-tight">
            Import History: {view.accountName}
          </h2>
        </div>

        <div className="border border-sq-black">
          {/* Header */}
          <div className="grid grid-cols-12 gap-4 px-6 py-3 bg-sq-gray-100 border-b border-sq-black">
            <div className="col-span-4 sq-label-muted">Filename</div>
            <div className="col-span-3 text-right sq-label-muted">Date</div>
            <div className="col-span-2 text-right sq-label-muted">Rows</div>
            <div className="col-span-3 text-right sq-label-muted">Actions</div>
          </div>
          {/* Rows */}
          {batches.length === 0 ? (
            <div className="px-6 py-8 text-center text-sq-gray-600 font-sans text-[14px]">
              No imports yet for this account.
            </div>
          ) : (
            batches.map((batch) => (
              <div
                key={batch.id}
                className="grid grid-cols-12 gap-4 px-6 py-4 border-b border-sq-gray-100 items-center"
              >
                <div className="col-span-4 font-mono text-[14px] text-sq-black">{batch.file_name}</div>
                <div className="col-span-3 text-right font-sans text-[14px] text-sq-gray-600">
                  {formatDate(batch.import_date)}
                </div>
                <div className="col-span-2 text-right font-mono text-[14px] text-sq-gray-600">
                  {batch.imported_count}
                  {batch.skipped_count > 0 && (
                    <span className="text-sq-red ml-3">({batch.skipped_count} skipped)</span>
                  )}
                </div>
                <div className="col-span-3 text-right flex justify-end gap-4">
                  <button
                    onClick={async () => {
                      if (confirm("Delete this import batch and all its transactions? This cannot be undone.")) {
                        await supabase.from("import_batches").delete().eq("id", batch.id);
                        loadHistory(view.accountId);
                      }
                    }}
                    className="text-sq-red hover:underline font-sans text-[12px] uppercase font-semibold"
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    );
  };

  // ─── Reconciliation Tool View ────────────────
  const renderReconcile = () => {
    if (view.mode !== "reconcile") return null;
    const actual = parseFloat(actualBalance.replace(/[^0-9.\-]/g, "")) || 0;
    const variance = actual - calculatedBalance;
    const hasVariance = actualBalance !== "" && Math.abs(variance) > 0.005;

    return (
      <div className="max-w-3xl">
        <div className="flex items-center gap-4 mb-8">
          <button onClick={() => setView({ mode: "gallery" })} className="text-sq-gray-600 hover:text-sq-black">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <h2 className="font-sans font-extrabold text-[32px] text-sq-black uppercase tracking-tight">
            Reconcile: {view.accountName}
          </h2>
        </div>

        <div className="grid grid-cols-2 gap-8 mb-8">
          <Card className="bg-sq-gray-100">
            <div className="sq-label-muted mb-2">System Calculated Balance</div>
            <div className="font-mono text-[36px] font-bold text-sq-black">
              {formatCurrency(calculatedBalance)}
            </div>
            <div className="font-sans text-[13px] text-sq-gray-600 mt-2">
              Based on {txCount} imported transactions
            </div>
          </Card>
          <Card>
            <div className="sq-label-muted mb-2">Actual Bank Balance</div>
            <input
              type="text"
              value={actualBalance}
              onChange={(e) => setActualBalance(e.target.value)}
              placeholder="$0.00"
              className="w-full bg-sq-white border-2 border-sq-black font-mono text-[36px] font-bold text-sq-black outline-none focus:border-sq-blue px-4 py-3"
            />
            <div className="font-sans text-[13px] text-sq-gray-600 mt-2">
              Enter current balance from statement
            </div>
          </Card>
        </div>

        {hasVariance && (
          <div className="border-2 border-sq-red p-6 bg-red-50 flex justify-between items-center mb-8">
            <div>
              <div className="font-sans font-bold text-[14px] uppercase tracking-widest text-sq-red mb-1">
                Variance Detected
              </div>
              <div className="font-mono text-[24px] font-bold text-sq-red">
                {formatCurrency(variance)}
              </div>
            </div>
            <div className="text-right">
              <p className="font-sans text-[15px] text-sq-black max-w-md mb-4">
                The calculated balance does not match your statement. This may
                indicate missing transactions or duplicates.
              </p>
              <Button variant="danger">Review Transactions</Button>
            </div>
          </div>
        )}

        <div className="flex justify-end">
          <Button>Save Reconciliation</Button>
        </div>
      </div>
    );
  };

  return (
    <PageShell userName={userName}>
      {view.mode === "gallery" && renderGallery()}
      {view.mode === "create" && renderCreate()}
      {view.mode === "history" && renderHistory()}
      {view.mode === "reconcile" && renderReconcile()}
    </PageShell>
  );
}

// ─── Account Card Component ────────────────────
function AccountCard({
  account,
  onHistory,
  onReconcile,
}: {
  account: Account;
  onHistory: () => void;
  onReconcile: () => void;
}) {
  const icon = accountTypeIcon[account.type] || accountTypeIcon.other;

  return (
    <Card hover>
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 border-2 border-sq-black flex items-center justify-center bg-sq-gray-100">
            {icon}
          </div>
          <div>
            <div className="font-sans font-bold text-[18px] text-sq-black">{account.name}</div>
            <div className="font-sans text-[11px] uppercase tracking-widest text-sq-gray-600">
              {account.type.replace("_", " ")}
            </div>
          </div>
        </div>
      </div>

      <div className="mb-4">
        <div className="sq-label-muted mb-1">Currency</div>
        <div className="font-mono text-[20px] font-bold text-sq-black">{account.currency}</div>
      </div>

      <div className="mb-6">
        <div className="sq-label-muted mb-1">Created</div>
        <div className="font-sans text-[14px] text-sq-black">{formatDate(account.created_at)}</div>
      </div>

      <div className="flex gap-2 pt-4 border-t border-sq-gray-100">
        <button
          onClick={onHistory}
          className="flex-1 border-2 border-sq-black py-2 font-sans text-[11px] uppercase font-semibold text-sq-black hover:bg-sq-black hover:text-sq-white transition-colors flex items-center justify-center gap-1"
        >
          <History className="w-3 h-3" />
          History
        </button>
        <button
          onClick={onReconcile}
          className="flex-1 border-2 border-sq-black py-2 font-sans text-[11px] uppercase font-semibold text-sq-black hover:bg-sq-black hover:text-sq-white transition-colors flex items-center justify-center gap-1"
        >
          <Scale className="w-3 h-3" />
          Reconcile
        </button>
      </div>
    </Card>
  );
}

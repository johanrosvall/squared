"use client";

export const dynamic = "force-dynamic";

import React, { useState, useEffect, useCallback } from "react";
import {
  Plus,
  Landmark,
  CreditCard,
  Users,
  PiggyBank,
  History,
  ArrowLeft,
  Archive,
  ArchiveRestore,
  Trash2,
} from "lucide-react";
import { PageShell } from "@/components/layout/PageShell";
import { Button, Card, Input, Select, useToast } from "@/components/ui";
import { createClient } from "@/lib/supabase/client";
import { formatDate } from "@/lib/utils";
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
  | { mode: "history"; accountId: string; accountName: string };

export default function AccountsPage() {
  const supabase = createClient();
  const { toast } = useToast();
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

  const fetchAccounts = useCallback(async () => {
    const { data } = await supabase
      .from("accounts")
      .select("*")
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

  const handleArchive = async (id: string) => {
    await supabase.from("accounts").update({ is_active: false }).eq("id", id);
    toast("Account archived");
    fetchAccounts();
  };

  const handleUnarchive = async (id: string) => {
    await supabase.from("accounts").update({ is_active: true }).eq("id", id);
    toast("Account restored");
    fetchAccounts();
  };

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`Permanently delete "${name}"?\n\nThis will also delete ALL transactions imported to this account. This cannot be undone.`)) return;
    await supabase.from("accounts").delete().eq("id", id);
    toast("Account deleted");
    fetchAccounts();
  };

  // ─── Gallery View ────────────────────────────
  const renderGallery = () => {
    const active = accounts.filter((a) => a.is_active);
    const archived = accounts.filter((a) => !a.is_active);

    return (
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

        {active.length === 0 ? (
          <Card className="text-center py-16 mb-8">
            <p className="font-sans text-sq-gray-600 text-[15px] mb-4">
              No active accounts. Create your first account to get started.
            </p>
            <Button onClick={() => setView({ mode: "create" })}>
              <Plus className="w-4 h-4" />
              Add Account
            </Button>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-12">
            {active.map((acct) => (
              <AccountCard
                key={acct.id}
                account={acct}
                onHistory={() => {
                  loadHistory(acct.id);
                  setView({ mode: "history", accountId: acct.id, accountName: acct.name });
                }}
                onArchive={() => handleArchive(acct.id)}
              />
            ))}
          </div>
        )}

        {/* ─── Archived Accounts ─── */}
        {archived.length > 0 && (
          <div>
            <h3 className="font-sans font-extrabold text-[18px] text-sq-gray-600 uppercase tracking-tight mb-4 flex items-center gap-2">
              <Archive className="w-4 h-4" />
              Archived ({archived.length})
            </h3>
            <div className="border border-sq-gray-100">
              {archived.map((acct) => (
                <div
                  key={acct.id}
                  className="flex items-center justify-between px-6 py-4 border-b border-sq-gray-100 last:border-b-0"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 border border-sq-gray-400 flex items-center justify-center opacity-40">
                      {accountTypeIcon[acct.type] || accountTypeIcon.other}
                    </div>
                    <div>
                      <div className="font-sans font-semibold text-[15px] text-sq-gray-600">{acct.name}</div>
                      <div className="font-sans text-[11px] uppercase tracking-widest text-sq-gray-400">
                        {acct.type.replace("_", " ")} · {acct.currency}
                      </div>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleUnarchive(acct.id)}
                      className="flex items-center gap-1.5 px-3 py-1.5 border border-sq-gray-400 font-sans text-[11px] uppercase font-semibold text-sq-gray-600 hover:border-sq-black hover:text-sq-black transition-colors"
                    >
                      <ArchiveRestore className="w-3 h-3" />
                      Restore
                    </button>
                    <button
                      onClick={() => handleDelete(acct.id, acct.name)}
                      className="flex items-center gap-1.5 px-3 py-1.5 border border-sq-gray-400 font-sans text-[11px] uppercase font-semibold text-sq-gray-600 hover:border-sq-red hover:text-sq-red transition-colors"
                    >
                      <Trash2 className="w-3 h-3" />
                      Delete
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  };

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

  return (
    <PageShell userName={userName}>
      {view.mode === "gallery" && renderGallery()}
      {view.mode === "create" && renderCreate()}
      {view.mode === "history" && renderHistory()}
    </PageShell>
  );
}

// ─── Account Card Component ────────────────────
function AccountCard({
  account,
  onHistory,
  onArchive,
}: {
  account: Account;
  onHistory: () => void;
  onArchive: () => void;
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
        <button
          onClick={onArchive}
          title="Archive account"
          className="text-sq-gray-400 hover:text-sq-gray-600 transition-colors"
        >
          <Archive className="w-4 h-4" />
        </button>
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
      </div>
    </Card>
  );
}

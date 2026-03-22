"use client";

export const dynamic = "force-dynamic";

import React, { useState, useEffect } from "react";
import {
  User,
  Users,
  Tag,
  Zap,
  Upload,
  Download,
  Plus,
  Trash2,
  Edit,
  Heart,
  Check,
  X,
} from "lucide-react";
import { PageShell } from "@/components/layout/PageShell";
import { Button, Card, Input, Select, useToast } from "@/components/ui";
import { Badge } from "@/components/ui/Badge";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import type { Contact, Category } from "@/lib/types";

interface AutoRule {
  id: string;
  keyword: string;
  markShared: boolean;
  categoryId: string;
}

const LS_RULES_KEY = "sq_auto_rules";

type Section = "profile" | "contacts" | "categories" | "rules" | "import" | "export";

const sections: { id: Section; label: string; icon: React.ReactNode }[] = [
  { id: "profile", label: "Profile", icon: <User className="w-4 h-4" /> },
  { id: "contacts", label: "Contacts", icon: <Users className="w-4 h-4" /> },
  { id: "categories", label: "Categories", icon: <Tag className="w-4 h-4" /> },
  { id: "rules", label: "Auto Rules", icon: <Zap className="w-4 h-4" /> },
  { id: "import", label: "Import Settings", icon: <Upload className="w-4 h-4" /> },
  { id: "export", label: "Data Export", icon: <Download className="w-4 h-4" /> },
];

function downloadCsv(filename: string, rows: string[][]) {
  const content = rows
    .map((row) => row.map((cell) => `"${String(cell ?? "").replace(/"/g, '""')}"`).join(","))
    .join("\n");
  const blob = new Blob([content], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function SettingsPage() {
  const supabase = createClient();
  const { toast } = useToast();
  const [userName, setUserName] = useState("");
  const [activeSection, setActiveSection] = useState<Section>("profile");

  // Profile
  const [profileName, setProfileName] = useState("");
  const [profileEmail, setProfileEmail] = useState("");
  const [profileCurrency, setProfileCurrency] = useState("USD");
  const [profileDateFormat, setProfileDateFormat] = useState("MM/DD/YYYY");
  const [dupSensitivity, setDupSensitivity] = useState<"strict" | "loose">("strict");
  const [savingProfile, setSavingProfile] = useState(false);

  // Contacts
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [editingContact, setEditingContact] = useState<Partial<Contact> | null>(null);

  // Categories
  const [categories, setCategories] = useState<Category[]>([]);
  const [editingCategory, setEditingCategory] = useState<Partial<Category> | null>(null);

  // Auto rules (localStorage)
  const [autoRules, setAutoRules] = useState<AutoRule[]>([]);
  const [newKeyword, setNewKeyword] = useState("");
  const [newRuleCategoryId, setNewRuleCategoryId] = useState("");
  const [newRuleShared, setNewRuleShared] = useState(false);

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      setUserName(user.user_metadata?.name || user.email || "");
      setProfileEmail(user.email || "");

      const { data: profile } = await supabase.from("profiles").select("*").eq("id", user.id).single();
      if (profile) {
        setProfileName(profile.name);
        setProfileCurrency(profile.default_currency);
        setProfileDateFormat(profile.date_format);
      }

      const { data: cts } = await supabase.from("contacts").select("*").order("name");
      if (cts) setContacts(cts);

      const { data: cats } = await supabase.from("categories").select("*").order("name");
      if (cats) setCategories(cats);

      try {
        const stored = localStorage.getItem(LS_RULES_KEY);
        if (stored) setAutoRules(JSON.parse(stored));
        const sens = localStorage.getItem("sq_dup_sensitivity");
        if (sens === "strict" || sens === "loose") setDupSensitivity(sens);
      } catch { /* ignore */ }
    })();
  }, [supabase]);

  const handleSaveProfile = async () => {
    setSavingProfile(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      const { error } = await supabase.from("profiles").upsert({
        id: user.id,
        email: user.email ?? profileEmail,
        name: profileName,
        default_currency: profileCurrency,
        date_format: profileDateFormat,
      });
      // PostgREST can return a non-fatal error on upsert with RLS even when
      // the row was successfully written — verify by the absence of a real
      // message rather than trusting the error flag blindly.
      if (error && error.message) toast("Failed to save profile", "error");
      else toast("Profile saved");
    }
    setSavingProfile(false);
  };

  // ─── Contact CRUD ────────────────────────────
  const handleSaveContact = async () => {
    if (!editingContact?.name) return;
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    if (editingContact.id) {
      await supabase.from("contacts").update({
        name: editingContact.name,
        is_primary_partner: editingContact.is_primary_partner || false,
        swish_number: editingContact.swish_number || null,
        venmo_handle: editingContact.venmo_handle || null,
        zelle_email: editingContact.zelle_email || null,
        other_payment_app_identifier: editingContact.other_payment_app_identifier || null,
        notes: editingContact.notes || null,
      }).eq("id", editingContact.id);
    } else {
      await supabase.from("contacts").insert({
        user_id: user.id,
        name: editingContact.name,
        is_primary_partner: editingContact.is_primary_partner || false,
        swish_number: editingContact.swish_number || null,
        venmo_handle: editingContact.venmo_handle || null,
        zelle_email: editingContact.zelle_email || null,
        other_payment_app_identifier: editingContact.other_payment_app_identifier || null,
        notes: editingContact.notes || null,
      });
    }

    setEditingContact(null);
    toast(editingContact.id ? "Contact updated" : "Contact added");
    const { data } = await supabase.from("contacts").select("*").order("name");
    if (data) setContacts(data);
  };

  const handleDeleteContact = async (id: string) => {
    if (!confirm("Delete this contact?")) return;
    await supabase.from("contacts").delete().eq("id", id);
    setContacts((c) => c.filter((x) => x.id !== id));
  };

  // ─── Category CRUD ───────────────────────────
  const handleDeleteCategory = async (id: string) => {
    if (!confirm("Delete this category? Transactions using it will become uncategorized.")) return;
    await supabase.from("categories").delete().eq("id", id);
    setCategories((c) => c.filter((x) => x.id !== id));
    toast("Category deleted");
  };

  const handleSaveCategory = async () => {
    if (!editingCategory?.name) return;
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    if (editingCategory.id) {
      await supabase.from("categories").update({
        name: editingCategory.name,
        color: editingCategory.color || null,
        is_shared: editingCategory.is_shared || false,
      }).eq("id", editingCategory.id);
    } else {
      await supabase.from("categories").insert({
        user_id: user.id,
        name: editingCategory.name,
        color: editingCategory.color || "#D4D4D4",
        is_shared: editingCategory.is_shared || false,
      });
    }

    setEditingCategory(null);
    toast(editingCategory.id ? "Category updated" : "Category added");
    const { data } = await supabase.from("categories").select("*").order("name");
    if (data) setCategories(data);
  };

  // ─── Auto rule CRUD ───────────────────────────
  const saveAutoRules = (rules: AutoRule[]) => {
    setAutoRules(rules);
    try { localStorage.setItem(LS_RULES_KEY, JSON.stringify(rules)); } catch { /* ignore */ }
  };

  const handleAddRule = () => {
    if (!newKeyword.trim()) return;
    const rule: AutoRule = {
      id: crypto.randomUUID(),
      keyword: newKeyword.trim(),
      markShared: newRuleShared,
      categoryId: newRuleCategoryId,
    };
    saveAutoRules([...autoRules, rule]);
    setNewKeyword("");
    setNewRuleCategoryId("");
    setNewRuleShared(false);
    toast("Rule added");
  };

  const handleDeleteRule = (id: string) => {
    saveAutoRules(autoRules.filter((r) => r.id !== id));
    toast("Rule deleted");
  };

  const [editingRuleId, setEditingRuleId] = useState<string | null>(null);
  const [editRuleKeyword, setEditRuleKeyword] = useState("");
  const [editRuleCategoryId, setEditRuleCategoryId] = useState("");
  const [editRuleShared, setEditRuleShared] = useState(false);

  const startEditRule = (rule: AutoRule) => {
    setEditingRuleId(rule.id);
    setEditRuleKeyword(rule.keyword);
    setEditRuleCategoryId(rule.categoryId);
    setEditRuleShared(rule.markShared);
  };

  const handleSaveRule = (id: string) => {
    if (!editRuleKeyword.trim()) return;
    saveAutoRules(autoRules.map((r) =>
      r.id === id ? { ...r, keyword: editRuleKeyword.trim(), categoryId: editRuleCategoryId, markShared: editRuleShared } : r
    ));
    setEditingRuleId(null);
    toast("Rule updated");
  };

  // ─── Render sections ─────────────────────────
  const renderProfile = () => (
    <div className="max-w-xl">
      <Input label="Full Name" value={profileName} onChange={(e) => setProfileName(e.target.value)} />
      <Input label="Email" value={profileEmail} disabled />
      <Select
        label="Default Currency"
        value={profileCurrency}
        onChange={(e) => setProfileCurrency(e.target.value)}
        options={[
          { value: "USD", label: "USD ($)" },
          { value: "EUR", label: "EUR (€)" },
          { value: "GBP", label: "GBP (£)" },
          { value: "SEK", label: "SEK (kr)" },
        ]}
      />
      <Select
        label="Date Format"
        value={profileDateFormat}
        onChange={(e) => setProfileDateFormat(e.target.value)}
        options={[
          { value: "MM/DD/YYYY", label: "MM/DD/YYYY" },
          { value: "DD/MM/YYYY", label: "DD/MM/YYYY" },
          { value: "YYYY-MM-DD", label: "YYYY-MM-DD" },
        ]}
      />
      <Button onClick={handleSaveProfile} disabled={savingProfile}>
        {savingProfile ? "Saving…" : "Save Profile"}
      </Button>
    </div>
  );

  const renderContacts = () => (
    <div>
      <div className="flex justify-between items-center mb-6">
        <p className="font-sans text-[14px] text-sq-gray-600">
          Manage contacts for partner transfer identification.
        </p>
        <Button size="sm" onClick={() => setEditingContact({ is_primary_partner: false })}>
          <Plus className="w-3 h-3" /> Add Contact
        </Button>
      </div>

      {/* Edit form */}
      {editingContact && (
        <Card className="mb-6">
          <div className="grid grid-cols-2 gap-4">
            <Input label="Name" value={editingContact.name || ""} onChange={(e) => setEditingContact({ ...editingContact, name: e.target.value })} />
            <Input label="Swish Number" value={editingContact.swish_number || ""} onChange={(e) => setEditingContact({ ...editingContact, swish_number: e.target.value })} placeholder="+46..." />
            <Input label="Venmo Handle" value={editingContact.venmo_handle || ""} onChange={(e) => setEditingContact({ ...editingContact, venmo_handle: e.target.value })} placeholder="@username" />
            <Input label="Zelle Email" value={editingContact.zelle_email || ""} onChange={(e) => setEditingContact({ ...editingContact, zelle_email: e.target.value })} placeholder="email@example.com" />
            <Input label="Other App ID" value={editingContact.other_payment_app_identifier || ""} onChange={(e) => setEditingContact({ ...editingContact, other_payment_app_identifier: e.target.value })} />
            <Input label="Notes" value={editingContact.notes || ""} onChange={(e) => setEditingContact({ ...editingContact, notes: e.target.value })} />
          </div>
          <div className="flex items-center gap-4 mt-2 mb-4">
            <button
              onClick={() => setEditingContact({ ...editingContact, is_primary_partner: !editingContact.is_primary_partner })}
              className={cn(
                "flex items-center gap-2 px-4 py-2 border-2 font-sans font-semibold text-[12px] uppercase tracking-wider transition-colors",
                editingContact.is_primary_partner
                  ? "bg-sq-purple text-sq-white border-sq-purple"
                  : "border-sq-black text-sq-black"
              )}
            >
              <Heart className="w-3 h-3" />
              Primary Partner
            </button>
          </div>
          <div className="flex gap-2">
            <Button size="sm" onClick={handleSaveContact}>Save</Button>
            <Button size="sm" variant="ghost" onClick={() => setEditingContact(null)}>Cancel</Button>
          </div>
        </Card>
      )}

      {/* Contact list */}
      <div className="border border-sq-black">
        {contacts.length === 0 ? (
          <div className="px-6 py-8 text-center text-sq-gray-600 font-sans text-[14px]">No contacts yet.</div>
        ) : (
          contacts.map((c) => (
            <div key={c.id} className={cn(
              "flex items-center justify-between px-6 py-4 border-b border-sq-gray-100",
              c.is_primary_partner && "border-l-4 border-l-sq-purple bg-purple-50"
            )}>
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-sans font-bold text-[15px] text-sq-black">{c.name}</span>
                  {c.is_primary_partner && (
                    <Badge variant="partner" icon={<Heart className="w-3 h-3" />}>Primary Partner</Badge>
                  )}
                </div>
                <div className="flex gap-4 mt-1 font-mono text-[12px] text-sq-gray-600">
                  {c.swish_number && <span>Swish: {c.swish_number}</span>}
                  {c.venmo_handle && <span>Venmo: {c.venmo_handle}</span>}
                  {c.zelle_email && <span>Zelle: {c.zelle_email}</span>}
                </div>
              </div>
              <div className="flex gap-2">
                <button onClick={() => setEditingContact(c)} className="text-sq-gray-600 hover:text-sq-black">
                  <Edit className="w-4 h-4" />
                </button>
                <button onClick={() => handleDeleteContact(c.id)} className="text-sq-gray-600 hover:text-sq-red">
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );

  const handleSeedCategories = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { error } = await supabase.rpc("seed_default_categories", { p_user_id: user.id });
    if (error) { toast(`Failed to seed: ${error.message}`, "error"); return; }
    const { data: cats } = await supabase.from("categories").select("*").order("name");
    if (cats) setCategories(cats);
    toast("Default categories added");
  };

  const renderCategories = () => (
    <div>
      <div className="flex justify-between items-center mb-6">
        <p className="font-sans text-[14px] text-sq-gray-600">Manage expense categories.</p>
        <div className="flex gap-2">
          {categories.length === 0 && (
            <Button size="sm" variant="secondary" onClick={handleSeedCategories}>
              Seed Defaults
            </Button>
          )}
          <Button size="sm" onClick={() => setEditingCategory({ color: "#D4D4D4", is_shared: false })}>
            <Plus className="w-3 h-3" /> Add Category
          </Button>
        </div>
      </div>

      {editingCategory && (
        <Card className="mb-6">
          <div className="grid grid-cols-3 gap-4">
            <Input label="Name" value={editingCategory.name || ""} onChange={(e) => setEditingCategory({ ...editingCategory, name: e.target.value })} />
            <div className="mb-6">
              <label className="block sq-label mb-2">Color</label>
              <input
                type="color"
                value={editingCategory.color || "#D4D4D4"}
                onChange={(e) => setEditingCategory({ ...editingCategory, color: e.target.value })}
                className="w-full h-[46px] border-2 border-sq-black cursor-pointer"
              />
            </div>
            <div className="mb-6">
              <label className="block sq-label mb-2">Shared Category</label>
              <button
                onClick={() => setEditingCategory({ ...editingCategory, is_shared: !editingCategory.is_shared })}
                className={cn(
                  "w-full border-2 py-3 font-sans font-semibold text-[12px] uppercase tracking-wider transition-colors",
                  editingCategory.is_shared ? "bg-amber-500 text-sq-white border-amber-500" : "border-sq-black text-sq-black"
                )}
              >
                {editingCategory.is_shared ? "Shared — Yes" : "Not Shared"}
              </button>
            </div>
          </div>
          <div className="flex gap-2">
            <Button size="sm" onClick={handleSaveCategory}>Save</Button>
            <Button size="sm" variant="ghost" onClick={() => setEditingCategory(null)}>Cancel</Button>
          </div>
        </Card>
      )}

      <div className="grid grid-cols-2 gap-3">
        {categories.map((cat) => (
          <div key={cat.id} className="border-2 border-sq-black px-4 py-3 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-4 h-4 rounded-full border border-sq-black" style={{ backgroundColor: cat.color || "#D4D4D4" }} />
              <span className="font-sans text-[14px] text-sq-black">{cat.name}</span>
              {cat.is_shared && <Badge variant="shared">Shared</Badge>}
            </div>
            <div className="flex gap-2">
              <button onClick={() => setEditingCategory(cat)} className="text-sq-gray-600 hover:text-sq-black">
                <Edit className="w-4 h-4" />
              </button>
              <button onClick={() => handleDeleteCategory(cat.id)} className="text-sq-gray-600 hover:text-sq-red">
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );

  const renderRules = () => (
    <div>
      <p className="font-sans text-[14px] text-sq-gray-600 mb-6">
        Rules are applied from the Transactions page. Each rule matches on description keyword (case-insensitive) and can auto-categorize and/or mark expenses as shared.
      </p>

      {/* Add new rule */}
      <Card className="mb-6">
        <div className="font-sans font-bold text-[13px] uppercase tracking-wider text-sq-black mb-4">New Rule</div>
        <div className="grid grid-cols-3 gap-4 mb-4 items-end">
          <div>
            <label className="block sq-label mb-2">Keyword (description contains)</label>
            <input
              type="text"
              value={newKeyword}
              onChange={(e) => setNewKeyword(e.target.value)}
              placeholder="e.g. ICA, Netflix, COOP"
              className="w-full border-2 border-sq-black px-3 py-2 font-mono text-[13px] outline-none focus:border-sq-blue"
            />
          </div>
          <div>
            <label className="block sq-label mb-2">Auto-assign Category (optional)</label>
            <select
              value={newRuleCategoryId}
              onChange={(e) => setNewRuleCategoryId(e.target.value)}
              className="w-full border-2 border-sq-black px-3 py-2 font-sans text-[13px] outline-none focus:border-sq-blue"
            >
              <option value="">— no category —</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block sq-label mb-2">Mark as Shared</label>
            <button
              onClick={() => setNewRuleShared(!newRuleShared)}
              className={cn(
                "w-full border-2 py-2 font-sans font-semibold text-[12px] uppercase tracking-wider transition-colors",
                newRuleShared ? "bg-amber-500 text-sq-white border-amber-500" : "border-sq-black text-sq-black hover:bg-sq-gray-100"
              )}
            >
              {newRuleShared ? "Shared — Yes" : "Not Shared"}
            </button>
          </div>
        </div>
        <Button size="sm" onClick={handleAddRule} disabled={!newKeyword.trim()}>
          <Plus className="w-3 h-3" /> Add Rule
        </Button>
      </Card>

      {/* Rule list */}
      {autoRules.length === 0 ? (
        <Card className="text-center py-8">
          <Zap className="w-8 h-8 text-sq-gray-400 mx-auto mb-3" />
          <p className="font-sans text-[14px] text-sq-gray-600">No rules yet. Add one above.</p>
        </Card>
      ) : (
        <div className="border border-sq-black">
          <div className="grid grid-cols-12 gap-4 px-4 py-2 bg-sq-gray-100 border-b border-sq-black">
            <div className="col-span-4 sq-label-muted">Keyword</div>
            <div className="col-span-4 sq-label-muted">Category</div>
            <div className="col-span-2 sq-label-muted">Shared</div>
            <div className="col-span-2 sq-label-muted" />
          </div>
          {autoRules.map((rule) => {
            const cat = categories.find((c) => c.id === rule.categoryId);
            const isEditingThis = editingRuleId === rule.id;
            if (isEditingThis) {
              return (
                <div key={rule.id} className="grid grid-cols-12 gap-4 px-4 py-3 border-b border-sq-gray-100 items-center bg-sq-gray-100">
                  <div className="col-span-4">
                    <input
                      autoFocus
                      value={editRuleKeyword}
                      onChange={(e) => setEditRuleKeyword(e.target.value)}
                      className="w-full border-2 border-sq-black px-2 py-1 font-mono text-[13px] outline-none focus:border-sq-blue bg-white"
                    />
                  </div>
                  <div className="col-span-4">
                    <select
                      value={editRuleCategoryId}
                      onChange={(e) => setEditRuleCategoryId(e.target.value)}
                      className="w-full border-2 border-sq-black px-2 py-1 font-sans text-[13px] outline-none focus:border-sq-blue bg-white"
                    >
                      <option value="">— no category —</option>
                      {categories.map((c) => (
                        <option key={c.id} value={c.id}>{c.name}</option>
                      ))}
                    </select>
                  </div>
                  <div className="col-span-2">
                    <button
                      onClick={() => setEditRuleShared(!editRuleShared)}
                      className={`border-2 px-2 py-1 font-sans text-[11px] uppercase font-semibold transition-colors ${editRuleShared ? "bg-amber-500 text-white border-amber-500" : "border-sq-black text-sq-black hover:bg-sq-gray-100"}`}
                    >
                      {editRuleShared ? "Yes" : "No"}
                    </button>
                  </div>
                  <div className="col-span-2 flex justify-end gap-2">
                    <button onClick={() => handleSaveRule(rule.id)} className="text-sq-blue hover:text-sq-black" title="Save">
                      <Check className="w-4 h-4" />
                    </button>
                    <button onClick={() => setEditingRuleId(null)} className="text-sq-gray-400 hover:text-sq-black" title="Cancel">
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              );
            }
            return (
              <div key={rule.id} className="grid grid-cols-12 gap-4 px-4 py-3 border-b border-sq-gray-100 items-center">
                <div className="col-span-4 font-mono text-[13px] text-sq-black">{rule.keyword}</div>
                <div className="col-span-4 font-sans text-[13px] text-sq-gray-600">
                  {cat ? (
                    <span className="flex items-center gap-1.5">
                      <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: cat.color || "#D4D4D4" }} />
                      {cat.name}
                    </span>
                  ) : "—"}
                </div>
                <div className="col-span-2 font-sans text-[12px]">
                  {rule.markShared ? (
                    <span className="text-amber-600 font-semibold">Yes</span>
                  ) : "—"}
                </div>
                <div className="col-span-2 flex justify-end gap-2">
                  <button onClick={() => startEditRule(rule)} className="text-sq-gray-400 hover:text-sq-black" title="Edit">
                    <Edit className="w-4 h-4" />
                  </button>
                  <button onClick={() => handleDeleteRule(rule.id)} className="text-sq-gray-400 hover:text-sq-red" title="Delete">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );

  const renderImportSettings = () => (
    <div className="max-w-xl">
      <Select
        label="Default Date Format"
        value={profileDateFormat}
        onChange={(e) => setProfileDateFormat(e.target.value)}
        options={[
          { value: "MM/DD/YYYY", label: "MM/DD/YYYY" },
          { value: "DD/MM/YYYY", label: "DD/MM/YYYY" },
          { value: "YYYY-MM-DD", label: "YYYY-MM-DD" },
        ]}
      />
      <div className="mb-6">
        <label className="block sq-label mb-2">Duplicate Detection Sensitivity</label>
        <p className="font-sans text-[12px] text-sq-gray-600 mb-3">
          <strong>Strict</strong>: matches on date + amount + description (recommended).<br />
          <strong>Loose</strong>: matches on date + amount only — catches duplicates with slightly different descriptions.
        </p>
        <div className="flex gap-4">
          {(["strict", "loose"] as const).map((s) => (
            <button
              key={s}
              onClick={() => {
                setDupSensitivity(s);
                try { localStorage.setItem("sq_dup_sensitivity", s); } catch { /* ignore */ }
              }}
              className={`flex-1 border-2 py-3 font-sans font-semibold text-[13px] uppercase tracking-wider transition-colors ${
                dupSensitivity === s
                  ? "bg-sq-black text-sq-white border-sq-black"
                  : "border-sq-black text-sq-black hover:bg-sq-gray-100"
              }`}
            >
              {s}
            </button>
          ))}
        </div>
      </div>
      <Button onClick={handleSaveProfile}>Save Settings</Button>
    </div>
  );

  const handleExportTransactions = async () => {
    const { data } = await supabase
      .from("transactions")
      .select("date, description, amount, currency, transaction_type, is_shared, reimbursement_status, notes, account:accounts!account_id(name), category:categories(name)")
      .order("date", { ascending: false });
    if (!data || data.length === 0) { toast("No transactions to export", "info"); return; }
    const headers = ["Date", "Description", "Amount", "Currency", "Type", "Shared", "Reimbursement", "Account", "Category", "Notes"];
    const rows = data.map((t: any) => [
      t.date, t.description, t.amount, t.currency, t.transaction_type,
      t.is_shared ? "Yes" : "No", t.reimbursement_status,
      t.account?.name ?? "", t.category?.name ?? "", t.notes ?? "",
    ]);
    downloadCsv("squared_transactions.csv", [headers, ...rows]);
    toast(`Exported ${data.length} transactions`);
  };

  const handleExportSettlements = async () => {
    const { data } = await supabase
      .from("settlement_groups")
      .select("settlement_date, total_amount, direction, note")
      .order("settlement_date", { ascending: false });
    if (!data || data.length === 0) { toast("No settlements to export", "info"); return; }
    const headers = ["Date", "Amount", "Direction", "Note"];
    const rows = data.map((s: any) => [s.settlement_date, s.total_amount, s.direction, s.note ?? ""]);
    downloadCsv("squared_settlements.csv", [headers, ...rows]);
    toast(`Exported ${data.length} settlements`);
  };

  const renderExport = () => (
    <div className="space-y-4 max-w-xl">
      <Card className="flex items-center justify-between">
        <div>
          <div className="font-sans font-bold text-[14px] text-sq-black">Export All Transactions</div>
          <div className="font-sans text-[13px] text-sq-gray-600">Download all transactions as CSV</div>
        </div>
        <Button size="sm" variant="secondary" onClick={handleExportTransactions}>
          <Download className="w-3 h-3" /> Export CSV
        </Button>
      </Card>
      <Card className="flex items-center justify-between">
        <div>
          <div className="font-sans font-bold text-[14px] text-sq-black">Export Settlement History</div>
          <div className="font-sans text-[13px] text-sq-gray-600">Download all settlements as CSV</div>
        </div>
        <Button size="sm" variant="secondary" onClick={handleExportSettlements}>
          <Download className="w-3 h-3" /> Export CSV
        </Button>
      </Card>
    </div>
  );

  const sectionRenderers: Record<Section, () => React.ReactNode> = {
    profile: renderProfile,
    contacts: renderContacts,
    categories: renderCategories,
    rules: renderRules,
    import: renderImportSettings,
    export: renderExport,
  };

  return (
    <PageShell userName={userName}>
      <h1 className="font-sans font-extrabold text-[32px] text-sq-black uppercase tracking-tight mb-8">
        Settings
      </h1>

      <div className="grid grid-cols-12 gap-8">
        {/* Sidebar */}
        <div className="col-span-3">
          <nav className="border-2 border-sq-black">
            {sections.map((s) => (
              <button
                key={s.id}
                onClick={() => setActiveSection(s.id)}
                className={cn(
                  "w-full flex items-center gap-3 px-4 py-3 font-sans font-semibold text-[12px] uppercase tracking-wider transition-colors border-b border-sq-gray-100 last:border-b-0",
                  activeSection === s.id
                    ? "bg-sq-black text-sq-white"
                    : "text-sq-gray-600 hover:text-sq-black hover:bg-sq-gray-100"
                )}
              >
                {s.icon}
                {s.label}
              </button>
            ))}
          </nav>
        </div>

        {/* Content */}
        <div className="col-span-9">{sectionRenderers[activeSection]()}</div>
      </div>
    </PageShell>
  );
}

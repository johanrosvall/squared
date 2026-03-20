"use client";

export const dynamic = "force-dynamic";

import React, { useState, useEffect, useCallback } from "react";
import * as XLSX from "xlsx";
import {
  Upload,
  CheckCircle,
  AlertTriangle,
  ChevronRight,
  FileText,
  ArrowLeft,
} from "lucide-react";
import { PageShell } from "@/components/layout/PageShell";
import { Button, Card, Select } from "@/components/ui";
import { createClient } from "@/lib/supabase/client";
import { formatCurrency, transactionFingerprint } from "@/lib/utils";
import type { Account, CsvColumnMapping, Transaction } from "@/lib/types";

type Step = 1 | 2 | 3 | 4;

export default function ImportPage() {
  const supabase = createClient();
  const [userName, setUserName] = useState("");
  const [step, setStep] = useState<Step>(1);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [selectedAccountId, setSelectedAccountId] = useState("");

  // Step 1: File
  const [csvText, setCsvText] = useState("");
  const [fileName, setFileName] = useState("");
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<string[][]>([]);

  // Step 2: Mapping
  const [mapping, setMapping] = useState<CsvColumnMapping>({
    date_column: "",
    date_type: "purchase",
    amount_column: "",
    amount_sign: "as_is",
    description_column: "",
    id_column: "",
  });

  // Step 3: Duplicates
  const [duplicates, setDuplicates] = useState<
    { row: Record<string, string>; existing: Transaction | null; action: "skip" | "import" }[]
  >([]);
  const [nonDuplicateRows, setNonDuplicateRows] = useState<Record<string, string>[]>([]);

  // Step 4: Summary
  const [importedCount, setImportedCount] = useState(0);
  const [failedRows, setFailedRows] = useState<{ row: number; reason: string }[]>([]);
  const [importing, setImporting] = useState(false);

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) setUserName(user.user_metadata?.name || user.email || "");
      const { data } = await supabase.from("accounts").select("*").eq("is_active", true).order("name");
      if (data) setAccounts(data);
    })();
  }, [supabase]);

  // ─── Step 1: Upload ──────────────────────────
  const [isXlsxFormat, setIsXlsxFormat] = useState(false);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);

    const isXlsx = /\.(xlsx|xls)$/i.test(file.name);
    if (isXlsx) {
      parseXLSX(file);
    } else {
      setIsXlsxFormat(false);
      const reader = new FileReader();
      reader.onload = (ev) => {
        const text = ev.target?.result as string;
        setCsvText(text);
        parseCSV(text);
      };
      reader.readAsText(file);
    }
  };

  // ─── XLSX Parser (Fakturadetaljer / Swedish CC format) ───
  const parseXLSX = (file: File) => {
    const reader = new FileReader();
    reader.onload = (ev) => {
      const data = ev.target?.result;
      const wb = XLSX.read(data, { type: "array" });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const allRows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" }) as (string | number)[][];

      // Detect "Fakturadetaljer" format: has "Datum"/"Bokfört"/"Belopp" header row
      const isFaktura = allRows.some(
        (row) => String(row[0]).trim() === "Datum" && String(row[1]).trim() === "Bokfört"
      );

      if (isFaktura) {
        // Extract only valid transaction rows:
        // - col 0 must be a YYYY-MM-DD date string
        // - col 6 must be a number (the SEK amount)
        const txRows = allRows.filter((row) => {
          const dateStr = String(row[0] || "");
          const amount = row[6];
          return /^\d{4}-\d{2}-\d{2}$/.test(dateStr) && typeof amount === "number";
        });

        const h = ["Datum", "Bokfört", "Beskrivning", "Ort", "Valuta", "Belopp"];
        const r = txRows.map((row) => [
          String(row[0]),                                           // purchase date
          String(row[1]),                                           // posted date
          String(row[2]),                                           // description
          String(row[3]),                                           // location
          String(row[4] || "SEK"),                                  // currency
          String(row[6]),                                           // SEK amount
        ]);

        setHeaders(h);
        setRows(r);
        setIsXlsxFormat(true);
        setMapping({
          date_column: "Datum",
          date_type: "purchase",
          amount_column: "Belopp",
          amount_sign: "as_is",
          description_column: "Beskrivning",
          id_column: "",
        });
      } else {
        // Generic XLSX: convert first sheet to CSV-like format
        setIsXlsxFormat(false);
        const jsonRows = XLSX.utils.sheet_to_json(ws, { defval: "" }) as Record<string, unknown>[];
        if (jsonRows.length === 0) return;
        const h = Object.keys(jsonRows[0]);
        const r = jsonRows.map((row) => h.map((k) => String(row[k] ?? "")));
        setHeaders(h);
        setRows(r);
        const lower = h.map((x) => x.toLowerCase());
        const dateCol = h[lower.findIndex((x) => x.includes("date"))] || "";
        const amtCol = h[lower.findIndex((x) => x.includes("amount") || x.includes("sum"))] || "";
        const descCol = h[lower.findIndex((x) => x.includes("description") || x.includes("memo") || x.includes("text"))] || "";
        setMapping((m) => ({ ...m, date_column: dateCol, amount_column: amtCol, description_column: descCol }));
      }
    };
    reader.readAsArrayBuffer(file);
  };

  const parseCSV = (text: string) => {
    const lines = text.split(/\r?\n/).filter((l) => l.trim());
    if (lines.length < 2) return;
    const parseLine = (line: string): string[] => {
      const result: string[] = [];
      let current = "";
      let inQuotes = false;
      for (const char of line) {
        if (char === '"') {
          inQuotes = !inQuotes;
        } else if (char === "," && !inQuotes) {
          result.push(current.trim());
          current = "";
        } else {
          current += char;
        }
      }
      result.push(current.trim());
      return result;
    };
    const h = parseLine(lines[0]);
    const r = lines.slice(1).map(parseLine);
    setHeaders(h);
    setRows(r);
    // Auto-guess mapping
    const lower = h.map((x) => x.toLowerCase());
    const dateCol = h[lower.findIndex((x) => x.includes("date"))] || "";
    const amtCol = h[lower.findIndex((x) => x.includes("amount") || x.includes("sum"))] || "";
    const descCol =
      h[lower.findIndex((x) => x.includes("description") || x.includes("memo") || x.includes("text"))] || "";
    setMapping((m) => ({
      ...m,
      date_column: dateCol,
      amount_column: amtCol,
      description_column: descCol,
    }));
  };

  const renderStep1 = () => (
    <div>
      <Select
        label="Target Account"
        value={selectedAccountId}
        onChange={(e) => setSelectedAccountId(e.target.value)}
        options={[
          { value: "", label: "Select an account…" },
          ...accounts.map((a) => ({ value: a.id, label: `${a.name} (${a.type.replace("_", " ")})` })),
        ]}
      />

      {/* Drop zone */}
      <div className="mb-6">
        <label className="block font-sans font-semibold text-[12px] uppercase tracking-widest text-sq-black mb-2">
          CSV File
        </label>
        <label className="border-2 border-dashed border-sq-black p-12 flex flex-col items-center justify-center cursor-pointer hover:bg-sq-gray-100 transition-colors">
          <Upload className="w-8 h-8 text-sq-gray-600 mb-3" />
          <span className="font-sans font-semibold text-[14px] text-sq-black">
            {fileName || "Click to select file"}
          </span>
          <span className="font-sans text-[12px] text-sq-gray-600 mt-1">
            CSV or XLSX — drag and drop or click
          </span>
          {isXlsxFormat && (
            <span className="mt-2 px-3 py-1 bg-sq-green text-sq-white font-sans font-semibold text-[11px] uppercase tracking-wider">
              Fakturadetaljer format detected — auto-mapped
            </span>
          )}
          <input
            type="file"
            accept=".csv,.tsv,.txt,.xlsx,.xls"
            className="hidden"
            onChange={handleFileSelect}
          />
        </label>
      </div>

      {/* Preview */}
      {rows.length > 0 && (
        <div>
          <div className="sq-label-muted mb-2">
            Preview ({rows.length} rows detected)
          </div>
          <div className="border border-sq-black overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="bg-sq-gray-100 border-b border-sq-black">
                  {headers.map((h, i) => (
                    <th key={i} className="px-4 py-2 text-left font-sans font-bold text-[11px] uppercase tracking-widest text-sq-gray-600">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, 3).map((row, ri) => (
                  <tr key={ri} className="border-b border-sq-gray-100">
                    {row.map((cell, ci) => (
                      <td key={ci} className="px-4 py-2 font-mono text-[13px] text-sq-black">
                        {cell}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="flex justify-end mt-8">
        <Button
          disabled={!selectedAccountId || rows.length === 0}
          onClick={() => isXlsxFormat ? handleCheckDuplicates() : setStep(2)}
        >
          {isXlsxFormat ? "Next: Check Duplicates" : "Next: Column Mapping"}
          <ChevronRight className="w-4 h-4" />
        </Button>
      </div>
    </div>
  );

  // ─── Step 2: Column Mapping ──────────────────
  const headerOptions = [
    { value: "", label: "— Select —" },
    ...headers.map((h) => ({ value: h, label: h })),
  ];

  const renderStep2 = () => (
    <div>
      <div className="grid grid-cols-2 gap-6">
        <Select
          label="Date Column"
          value={mapping.date_column}
          onChange={(e) => setMapping({ ...mapping, date_column: e.target.value })}
          options={headerOptions}
        />
        <div className="mb-6">
          <label className="block font-sans font-semibold text-[12px] uppercase tracking-widest text-sq-black mb-2">
            Date Type
          </label>
          <div className="flex gap-4">
            {(["purchase", "posted"] as const).map((t) => (
              <button
                key={t}
                onClick={() => setMapping({ ...mapping, date_type: t })}
                className={`flex-1 border-2 border-sq-black py-3 font-sans font-semibold text-[13px] uppercase tracking-wider transition-colors ${
                  mapping.date_type === t ? "bg-sq-black text-sq-white" : "text-sq-black hover:bg-sq-gray-100"
                }`}
              >
                {t} Date
              </button>
            ))}
          </div>
        </div>
        <Select
          label="Amount Column"
          value={mapping.amount_column}
          onChange={(e) => setMapping({ ...mapping, amount_column: e.target.value })}
          options={headerOptions}
        />
        <div className="mb-6">
          <label className="block font-sans font-semibold text-[12px] uppercase tracking-widest text-sq-black mb-2">
            Amount Sign Convention
          </label>
          <div className="flex gap-4">
            {([
              { value: "as_is", label: "As-Is" },
              { value: "invert", label: "Invert" },
            ] as const).map((opt) => (
              <button
                key={opt.value}
                onClick={() => setMapping({ ...mapping, amount_sign: opt.value })}
                className={`flex-1 border-2 border-sq-black py-3 font-sans font-semibold text-[13px] uppercase tracking-wider transition-colors ${
                  mapping.amount_sign === opt.value ? "bg-sq-black text-sq-white" : "text-sq-black hover:bg-sq-gray-100"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
        <Select
          label="Description Column"
          value={mapping.description_column}
          onChange={(e) => setMapping({ ...mapping, description_column: e.target.value })}
          options={headerOptions}
        />
        <Select
          label="Transaction ID Column (optional)"
          value={mapping.id_column || ""}
          onChange={(e) => setMapping({ ...mapping, id_column: e.target.value || undefined })}
          options={headerOptions}
        />
      </div>

      {/* Validation preview */}
      {mapping.date_column && mapping.amount_column && rows.length > 0 && (
        <div className="mt-6">
          <div className="sq-label-muted mb-2">Mapping Preview</div>
          <div className="border border-sq-black overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="bg-sq-gray-100 border-b border-sq-black">
                  <th className="px-4 py-2 text-left sq-label-muted">Date</th>
                  <th className="px-4 py-2 text-left sq-label-muted">Amount</th>
                  <th className="px-4 py-2 text-left sq-label-muted">Description</th>
                  <th className="px-4 py-2 text-left sq-label-muted">Valid?</th>
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, 5).map((row, ri) => {
                  const obj: Record<string, string> = {};
                  headers.forEach((h, i) => (obj[h] = row[i] || ""));
                  const dateVal = obj[mapping.date_column] || "";
                  const amtVal = obj[mapping.amount_column] || "";
                  const descVal = obj[mapping.description_column] || "";
                  const dateValid = !isNaN(Date.parse(dateVal));
                  const amtValid = !isNaN(parseFloat(amtVal.replace(/[^0-9.\-]/g, "")));
                  return (
                    <tr key={ri} className="border-b border-sq-gray-100">
                      <td className="px-4 py-2 font-mono text-[13px]">{dateVal}</td>
                      <td className="px-4 py-2 font-mono text-[13px]">{amtVal}</td>
                      <td className="px-4 py-2 font-sans text-[13px]">{descVal}</td>
                      <td className="px-4 py-2">
                        {dateValid && amtValid ? (
                          <CheckCircle className="w-4 h-4 text-sq-green" />
                        ) : (
                          <AlertTriangle className="w-4 h-4 text-sq-red" />
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="flex justify-between mt-8">
        <Button variant="ghost" onClick={() => setStep(1)}>
          <ArrowLeft className="w-4 h-4" /> Back
        </Button>
        <Button
          disabled={!mapping.date_column || !mapping.amount_column || !mapping.description_column}
          onClick={handleCheckDuplicates}
        >
          Next: Check Duplicates
          <ChevronRight className="w-4 h-4" />
        </Button>
      </div>
    </div>
  );

  // ─── Duplicate Detection ─────────────────────
  const handleCheckDuplicates = async () => {
    // Build row objects
    const allRowObjs = rows.map((row) => {
      const obj: Record<string, string> = {};
      headers.forEach((h, i) => (obj[h] = row[i] || ""));
      return obj;
    });

    // Fetch existing transactions for this account
    const { data: existing } = await supabase
      .from("transactions")
      .select("*")
      .eq("account_id", selectedAccountId);
    const existingFingerprints = new Map<string, Transaction>();
    (existing || []).forEach((t: Transaction) => {
      const fp = transactionFingerprint(t.date, Number(t.amount), t.description);
      existingFingerprints.set(fp, t);
    });

    const dupes: typeof duplicates = [];
    const clean: Record<string, string>[] = [];

    for (const rowObj of allRowObjs) {
      const dateStr = rowObj[mapping.date_column] || "";
      const amtStr = rowObj[mapping.amount_column] || "";
      const desc = rowObj[mapping.description_column] || "";
      let amt = parseFloat(amtStr.replace(/[^0-9.\-]/g, ""));
      if (isNaN(amt)) continue;
      if (mapping.amount_sign === "invert") amt = -amt;
      const parsedDate = new Date(dateStr);
      if (isNaN(parsedDate.getTime())) continue;
      const dateFormatted = parsedDate.toISOString().split("T")[0];
      const fp = transactionFingerprint(dateFormatted, amt, desc);

      if (existingFingerprints.has(fp)) {
        dupes.push({ row: rowObj, existing: existingFingerprints.get(fp)!, action: "skip" });
      } else {
        clean.push(rowObj);
      }
    }

    setDuplicates(dupes);
    setNonDuplicateRows(clean);
    setStep(3);
  };

  // ─── Step 3: Duplicate Review ────────────────
  const renderStep3 = () => (
    <div>
      {duplicates.length === 0 ? (
        <Card className="text-center py-8 mb-6">
          <CheckCircle className="w-8 h-8 text-sq-green mx-auto mb-3" />
          <p className="font-sans text-[15px] text-sq-black font-semibold">No duplicates detected!</p>
          <p className="font-sans text-[13px] text-sq-gray-600 mt-1">
            {nonDuplicateRows.length} transactions ready to import.
          </p>
        </Card>
      ) : (
        <>
          <div className="flex justify-between items-center mb-4">
            <div className="sq-label-muted">
              {duplicates.length} potential duplicate{duplicates.length !== 1 ? "s" : ""} found
            </div>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="secondary"
                onClick={() => setDuplicates((d) => d.map((x) => ({ ...x, action: "skip" })))}
              >
                Skip All
              </Button>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => setDuplicates((d) => d.map((x) => ({ ...x, action: "import" })))}
              >
                Import All
              </Button>
            </div>
          </div>
          <div className="space-y-4 mb-6">
            {duplicates.map((d, i) => (
              <Card key={i} className="flex items-center justify-between">
                <div className="flex-1">
                  <div className="font-mono text-[13px] text-sq-black">
                    {d.row[mapping.description_column]} — {d.row[mapping.amount_column]}
                  </div>
                  <div className="font-sans text-[12px] text-sq-gray-600 mt-1">
                    Date: {d.row[mapping.date_column]}
                  </div>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => {
                      const updated = [...duplicates];
                      updated[i].action = "skip";
                      setDuplicates(updated);
                    }}
                    className={`px-4 py-2 border-2 border-sq-black font-sans font-semibold text-[11px] uppercase tracking-wider transition-colors ${
                      d.action === "skip" ? "bg-sq-black text-sq-white" : "text-sq-black"
                    }`}
                  >
                    Skip
                  </button>
                  <button
                    onClick={() => {
                      const updated = [...duplicates];
                      updated[i].action = "import";
                      setDuplicates(updated);
                    }}
                    className={`px-4 py-2 border-2 border-sq-black font-sans font-semibold text-[11px] uppercase tracking-wider transition-colors ${
                      d.action === "import" ? "bg-sq-black text-sq-white" : "text-sq-black"
                    }`}
                  >
                    Import
                  </button>
                </div>
              </Card>
            ))}
          </div>
        </>
      )}

      <div className="flex justify-between mt-8">
        <Button variant="ghost" onClick={() => setStep(isXlsxFormat ? 1 : 2)}>
          <ArrowLeft className="w-4 h-4" /> Back
        </Button>
        <Button onClick={handleImport} disabled={importing}>
          {importing ? "Importing…" : `Import ${nonDuplicateRows.length + duplicates.filter((d) => d.action === "import").length} Transactions`}
          <ChevronRight className="w-4 h-4" />
        </Button>
      </div>
    </div>
  );

  // ─── Import Execution ────────────────────────
  const handleImport = async () => {
    setImporting(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    // Merge clean rows + accepted duplicates
    const toImport = [
      ...nonDuplicateRows,
      ...duplicates.filter((d) => d.action === "import").map((d) => d.row),
    ];
    const skipped = duplicates.filter((d) => d.action === "skip").length;

    // Create import batch
    const { data: batch } = await supabase
      .from("import_batches")
      .insert({
        user_id: user.id,
        account_id: selectedAccountId,
        file_name: fileName,
        file_hash: "",
        raw_row_count: rows.length,
        imported_count: 0,
        skipped_count: skipped,
      })
      .select()
      .single();

    if (!batch) {
      setImporting(false);
      return;
    }

    const errors: typeof failedRows = [];
    let successCount = 0;

    for (let i = 0; i < toImport.length; i++) {
      const rowObj = toImport[i];
      try {
        const dateStr = rowObj[mapping.date_column] || "";
        const amtStr = rowObj[mapping.amount_column] || "";
        const desc = rowObj[mapping.description_column] || "";
        // For XLSX Fakturadetaljer: combine description + location
        const location = isXlsxFormat ? (rowObj["Ort"] || "") : "";
        const fullDesc = location ? `${desc} — ${location}` : desc;
        const postedStr = isXlsxFormat ? (rowObj["Bokfört"] || "") : "";
        let amt = parseFloat(String(amtStr).replace(/[^0-9.\-]/g, ""));
        if (isNaN(amt)) throw new Error("Invalid amount");
        if (mapping.amount_sign === "invert") amt = -amt;
        const parsedDate = new Date(dateStr);
        if (isNaN(parsedDate.getTime())) throw new Error("Invalid date");
        const dateFormatted = parsedDate.toISOString().split("T")[0];
        const postedFormatted = postedStr ? new Date(postedStr).toISOString().split("T")[0] : null;

        // For XLSX: use the currency from the row, fall back to account currency
        const rowCurrency = isXlsxFormat ? (rowObj["Valuta"] || "") : "";
        const currency = rowCurrency || accounts.find((a) => a.id === selectedAccountId)?.currency || "SEK";

        const txType = amt < 0 ? "income" : "expense";

        await supabase.from("transactions").insert({
          account_id: selectedAccountId,
          import_batch_id: batch.id,
          date: dateFormatted,
          posted_date: postedFormatted || (mapping.date_type === "posted" ? dateFormatted : null),
          amount: amt,
          currency,
          description: fullDesc,
          raw_description: desc,
          transaction_type: txType,
        });
        successCount++;
      } catch (err: any) {
        errors.push({ row: i + 1, reason: err.message || "Unknown error" });
      }
    }

    // Update batch counts
    await supabase
      .from("import_batches")
      .update({ imported_count: successCount, skipped_count: skipped })
      .eq("id", batch.id);

    setImportedCount(successCount);
    setFailedRows(errors);
    setImporting(false);
    setStep(4);
  };

  // ─── Step 4: Summary ─────────────────────────
  const renderStep4 = () => (
    <div>
      <Card className="text-center py-12 mb-6">
        <CheckCircle className="w-12 h-12 text-sq-green mx-auto mb-4" />
        <h3 className="font-sans font-extrabold text-[24px] uppercase tracking-tight text-sq-black mb-2">
          Import Complete
        </h3>
        <p className="font-mono text-[20px] text-sq-green font-bold">
          {importedCount} transactions imported
        </p>
        {failedRows.length > 0 && (
          <p className="font-mono text-[14px] text-sq-red mt-2">
            {failedRows.length} rows failed
          </p>
        )}
      </Card>

      {failedRows.length > 0 && (
        <div className="mb-6">
          <div className="sq-label-muted mb-2">Failed Rows</div>
          <div className="border border-sq-black">
            {failedRows.map((f, i) => (
              <div key={i} className="px-4 py-2 border-b border-sq-gray-100 flex justify-between font-sans text-[13px]">
                <span>Row {f.row}</span>
                <span className="text-sq-red">{f.reason}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="flex justify-center gap-4">
        <Button variant="secondary" onClick={() => { setStep(1); setCsvText(""); setFileName(""); setHeaders([]); setRows([]); }}>
          Import Another File
        </Button>
        <Button onClick={() => (window.location.href = "/transactions")}>
          View Transactions
        </Button>
      </div>
    </div>
  );

  // ─── Progress Bar ────────────────────────────
  const steps = ["Upload", "Mapping", "Duplicates", "Summary"];

  return (
    <PageShell userName={userName}>
      <h2 className="font-sans font-extrabold text-[32px] text-sq-black uppercase tracking-tight mb-2">
        Import CSV
      </h2>

      {/* Step indicator */}
      <div className="flex items-center gap-2 mb-10">
        {steps.map((s, i) => {
          const stepNum = (i + 1) as Step;
          const isActive = step === stepNum;
          const isDone = step > stepNum;
          return (
            <React.Fragment key={s}>
              <div className="flex items-center gap-2">
                <div
                  className={`w-8 h-8 flex items-center justify-center font-mono text-[13px] font-bold border-2 ${
                    isDone
                      ? "bg-sq-black text-sq-white border-sq-black"
                      : isActive
                      ? "border-sq-black text-sq-black"
                      : "border-sq-gray-400 text-sq-gray-400"
                  }`}
                >
                  {isDone ? "✓" : stepNum}
                </div>
                <span
                  className={`font-sans font-semibold text-[12px] uppercase tracking-wider ${
                    isActive ? "text-sq-black" : isDone ? "text-sq-black" : "text-sq-gray-400"
                  }`}
                >
                  {s}
                </span>
              </div>
              {i < steps.length - 1 && <div className="flex-1 h-0.5 bg-sq-gray-100 mx-2" />}
            </React.Fragment>
          );
        })}
      </div>

      {step === 1 && renderStep1()}
      {step === 2 && renderStep2()}
      {step === 3 && renderStep3()}
      {step === 4 && renderStep4()}
    </PageShell>
  );
}

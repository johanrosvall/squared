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
  Download,
} from "lucide-react";
import { PageShell } from "@/components/layout/PageShell";
import { Button, Card, Select } from "@/components/ui";
import { createClient } from "@/lib/supabase/client";
import { formatCurrency, transactionFingerprint } from "@/lib/utils";
import type { Account, CsvColumnMapping, Transaction } from "@/lib/types";

type Step = 1 | 2 | 3 | 4;

// ─── Tolerant value coercers (shared between primary + extra XLSX parsers) ───
const eqHeader = (a: unknown, b: string) =>
  String(a ?? "").trim().toLowerCase() === b.toLowerCase();

const coerceDate = (v: unknown): string => {
  if (v == null || v === "") return "";
  if (typeof v === "number" && v > 25569 && v < 70000) {
    const ms = Math.round((v - 25569) * 86400) * 1000;
    const d = new Date(ms);
    if (!isNaN(d.getTime())) {
      const yyyy = d.getUTCFullYear();
      const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
      const dd = String(d.getUTCDate()).padStart(2, "0");
      return `${yyyy}-${mm}-${dd}`;
    }
  }
  const s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m1 = s.match(/^(\d{4})[\/.](\d{1,2})[\/.](\d{1,2})$/);
  if (m1) return `${m1[1]}-${m1[2].padStart(2, "0")}-${m1[3].padStart(2, "0")}`;
  const m2 = s.match(/^(\d{1,2})[\/.](\d{1,2})[\/.](\d{4})$/);
  if (m2) return `${m2[3]}-${m2[2].padStart(2, "0")}-${m2[1].padStart(2, "0")}`;
  return "";
};

const coerceAmount = (v: unknown): number | null => {
  if (typeof v === "number" && !isNaN(v)) return v;
  if (v == null || v === "") return null;
  const cleaned = String(v).replace(/\s|kr|SEK/gi, "").replace(/,/g, ".");
  const stripped = cleaned.replace(/[^\d.\-]/g, "");
  if (stripped === "" || stripped === "-" || stripped === ".") return null;
  const n = Number(stripped);
  return isNaN(n) ? null : n;
};

/**
 * Extract transaction rows from a Faktura-format XLSX (parsed as a 2D array).
 * Returns rows in the canonical 6-column shape: [Datum, Bokfört, Beskrivning, Ort, Valuta, Belopp].
 * Uses tolerant date/amount coercion so locale/format drift between exports doesn't break it.
 */
const extractFakturaRows = (allRows: (string | number)[][]): string[][] => {
  const isFaktura = allRows.some((row) => eqHeader(row[0], "Datum") && eqHeader(row[1], "Bokfört"));
  if (!isFaktura) return [];

  const kopIdx = allRows.findIndex((row) => eqHeader(row[0], "Köp/uttag"));
  let colBelopp = 6;
  let colUtlBelopp = 5;

  const tryParseRow = (row: (string | number)[]): (string | number)[] | null => {
    const date = coerceDate(row[0]);
    if (!date) return null;
    const amount = coerceAmount(row[colBelopp]);
    if (amount === null) return null;
    const newRow = [...row];
    newRow[0] = date;
    newRow[colBelopp] = amount;
    const utl = coerceAmount(row[colUtlBelopp]);
    if (utl !== null) newRow[colUtlBelopp] = utl;
    return newRow;
  };

  let txRows: (string | number)[][];
  if (kopIdx >= 0) {
    const headerIdx = allRows.findIndex(
      (row, i) => i > kopIdx && eqHeader(row[0], "Datum") && eqHeader(row[1], "Bokfört")
    );
    if (headerIdx >= 0) {
      const hRow = allRows[headerIdx];
      const bIdx = hRow.findIndex((h) => eqHeader(h, "Belopp"));
      const uIdx = hRow.findIndex((h) => eqHeader(h, "Utl. belopp"));
      if (bIdx >= 0) colBelopp = bIdx;
      if (uIdx >= 0) colUtlBelopp = uIdx;
    }
    const startIdx = headerIdx >= 0 ? headerIdx + 1 : kopIdx + 2;
    const kopRows = allRows.slice(startIdx)
      .map(tryParseRow)
      .filter((r): r is (string | number)[] => r !== null);

    const firstHeaderIdx = allRows.findIndex(
      (row) => eqHeader(row[0], "Datum") && eqHeader(row[1], "Bokfört")
    );
    const extraChargeRows = (firstHeaderIdx >= 0 && kopIdx > firstHeaderIdx)
      ? allRows.slice(firstHeaderIdx + 1, kopIdx)
          .map(tryParseRow)
          .filter((r): r is (string | number)[] => r !== null)
          .filter((row) => String(row[2] || "").toLowerCase().trim() !== "inbetalning")
      : [];

    txRows = [...extraChargeRows, ...kopRows];
  } else {
    txRows = allRows
      .map(tryParseRow)
      .filter((r): r is (string | number)[] => r !== null)
      .filter((row) => {
        const desc = String(row[2] || "").toLowerCase().trim();
        if (desc === "inbetalning") return false;
        if (desc.startsWith("ränta") || desc.startsWith("dröjsmål")) return false;
        return true;
      });
  }

  return txRows.map((row) => [
    String(row[0]),
    String(row[1]),
    String(row[2]),
    String(row[3]),
    String(row[4] || "SEK"),
    String(row[colBelopp]),
  ]);
};

export default function ImportPage() {
  const supabase = createClient();
  const [userName, setUserName] = useState("");
  const [step, setStep] = useState<Step>(1);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [selectedAccountId, setSelectedAccountId] = useState("");

  // Step 1: File(s)
  const [csvText, setCsvText] = useState("");
  const [fileName, setFileName] = useState("");
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<string[][]>([]);
  // Extra files beyond the first (same mapping applied to all)
  const [extraFiles, setExtraFiles] = useState<{ name: string; rows: string[][] }[]>([]);

  // Step 2: Mapping
  const [mapping, setMapping] = useState<CsvColumnMapping>({
    date_column: "",
    date_type: "purchase",
    amount_column: "",
    amount_sign: "as_is",
    description_column: "",
    id_column: "",
  });
  const [savedMappingLoaded, setSavedMappingLoaded] = useState(false);

  // Step 3: Duplicates
  const [duplicates, setDuplicates] = useState<
    { row: Record<string, string>; existing: Transaction | null; action: "skip" | "import" }[]
  >([]);
  const [nonDuplicateRows, setNonDuplicateRows] = useState<Record<string, string>[]>([]);

  // Step 4: Summary
  const [importedCount, setImportedCount] = useState(0);
  const [failedRows, setFailedRows] = useState<{ row: number; reason: string }[]>([]);
  const [importing, setImporting] = useState(false);
  const [importStatus, setImportStatus] = useState("");

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) setUserName(user.user_metadata?.name || user.email || "");
      const { data } = await supabase.from("accounts").select("*").eq("is_active", true).order("name");
      if (data) setAccounts(data);
    })();
  }, [supabase]);

  // ─── Saved mapping helpers ───────────────────
  const storageKey = (accountId: string) => `sq_mapping_${accountId}`;

  const loadSavedMapping = (accountId: string) => {
    try {
      const raw = localStorage.getItem(storageKey(accountId));
      if (!raw) return null;
      return JSON.parse(raw) as { mapping: CsvColumnMapping; isXlsx: boolean };
    } catch { return null; }
  };

  const saveMapping = (accountId: string, m: CsvColumnMapping, isXlsx: boolean) => {
    try {
      localStorage.setItem(storageKey(accountId), JSON.stringify({ mapping: m, isXlsx }));
    } catch { /* ignore */ }
  };

  // Apply saved mapping if its columns still exist in the current headers
  const applySavedIfValid = (h: string[], accountId: string): CsvColumnMapping | null => {
    const saved = loadSavedMapping(accountId);
    if (!saved) return null;
    const { mapping: m } = saved;
    if (h.includes(m.date_column) && h.includes(m.amount_column) && h.includes(m.description_column)) {
      return m;
    }
    return null;
  };

  // ─── Step 1: Upload ──────────────────────────
  const [isXlsxFormat, setIsXlsxFormat] = useState(false);
  const [fakturaMonth, setFakturaMonth] = useState("");      // e.g. "april 2025"
  const [fakturaCsvData, setFakturaCsvData] = useState(""); // normalized CSV string for download

  // When account changes, check if we have a saved mapping
  const handleAccountChange = (accountId: string) => {
    setSelectedAccountId(accountId);
    setSavedMappingLoaded(false);
    // If a file is already loaded, try applying saved mapping now
    if (headers.length > 0 && accountId) {
      const saved = applySavedIfValid(headers, accountId);
      if (saved) {
        setMapping(saved);
        setSavedMappingLoaded(true);
      }
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;

    setExtraFiles([]);
    setSavedMappingLoaded(false);

    const [first, ...rest] = files;
    setFileName(files.length > 1 ? `${files.length} files selected` : first.name);

    const parseExtra = (extraList: File[]) => {
      const results: { name: string; rows: string[][] }[] = [];
      let done = 0;
      if (extraList.length === 0) return;
      extraList.forEach((f) => {
        const isX = /\.(xlsx|xls)$/i.test(f.name);
        if (isX) {
          const reader = new FileReader();
          reader.onload = (ev) => {
            const wb = XLSX.read(ev.target?.result, { type: "array" });
            const ws = wb.Sheets[wb.SheetNames[0]];
            const allRows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" }) as (string | number)[][];
            const r = extractFakturaRows(allRows);
            results.push({ name: f.name, rows: r });
            if (++done === extraList.length) setExtraFiles([...results]);
          };
          reader.readAsArrayBuffer(f);
        } else {
          const reader = new FileReader();
          reader.onload = (ev) => {
            const text = ev.target?.result as string;
            const lines = text.split(/\r?\n/).filter((l) => l.trim());
            if (lines.length < 2) { if (++done === extraList.length) setExtraFiles([...results]); return; }
            const sep = [";", ",", "\t"].reduce((best, s) => {
              const count = (lines[0].split(s).length + lines[1].split(s).length) / 2;
              const bestCount = (lines[0].split(best).length + lines[1].split(best).length) / 2;
              return count > bestCount ? s : best;
            }, ",");
            const parseLine = (line: string) => line.split(sep).map((c) => c.trim().replace(/^"|"$/g, ""));
            results.push({ name: f.name, rows: lines.slice(1).map(parseLine) });
            if (++done === extraList.length) setExtraFiles([...results]);
          };
          reader.readAsText(f);
        }
      });
    };

    const isXlsx = /\.(xlsx|xls)$/i.test(first.name);
    if (isXlsx) {
      parseXLSX(first);
      if (rest.length > 0) parseExtra(rest);
    } else {
      setIsXlsxFormat(false);
      const reader = new FileReader();
      reader.onload = (ev) => {
        const text = ev.target?.result as string;
        setCsvText(text);
        parseCSV(text);
        if (rest.length > 0) parseExtra(rest);
      };
      reader.readAsText(first);
    }
  };

  // ─── Download normalized Faktura CSV ────────────────────
  const handleDownloadFakturaCSV = () => {
    if (!fakturaCsvData) return;
    const slug = fakturaMonth.toLowerCase().replace(/\s+/g, "-") || "faktura";
    const blob = new Blob(["\uFEFF" + fakturaCsvData], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${slug}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // ─── XLSX Parser (Fakturadetaljer / Swedish CC format) ───
  const parseXLSX = (file: File) => {
    const reader = new FileReader();
    reader.onload = (ev) => {
      const data = ev.target?.result;
      const wb = XLSX.read(data, { type: "array" });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const allRows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" }) as (string | number)[][];

      // ── Tolerant value coercers ──────────────────────────────────────
      const eqHeader = (a: unknown, b: string) =>
        String(a ?? "").trim().toLowerCase() === b.toLowerCase();

      const coerceDate = (v: unknown): string => {
        if (v == null || v === "") return "";
        // Excel date serial number (days since 1899-12-30)
        if (typeof v === "number" && v > 25569 && v < 70000) {
          const ms = Math.round((v - 25569) * 86400) * 1000;
          const d = new Date(ms);
          if (!isNaN(d.getTime())) {
            const yyyy = d.getUTCFullYear();
            const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
            const dd = String(d.getUTCDate()).padStart(2, "0");
            return `${yyyy}-${mm}-${dd}`;
          }
        }
        const s = String(v).trim();
        if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
        const m1 = s.match(/^(\d{4})[\/.](\d{1,2})[\/.](\d{1,2})$/);
        if (m1) return `${m1[1]}-${m1[2].padStart(2, "0")}-${m1[3].padStart(2, "0")}`;
        const m2 = s.match(/^(\d{1,2})[\/.](\d{1,2})[\/.](\d{4})$/);
        if (m2) return `${m2[3]}-${m2[2].padStart(2, "0")}-${m2[1].padStart(2, "0")}`;
        return "";
      };

      const coerceAmount = (v: unknown): number | null => {
        if (typeof v === "number" && !isNaN(v)) return v;
        if (v == null || v === "") return null;
        const cleaned = String(v)
          .replace(/ /g, " ")
          .replace(/\s|kr|SEK/gi, "")
          .replace(/,/g, ".");
        const stripped = cleaned.replace(/[^\d.\-]/g, "");
        if (stripped === "" || stripped === "-" || stripped === ".") return null;
        const n = Number(stripped);
        return isNaN(n) ? null : n;
      };

      const isFaktura = allRows.some(
        (row) => eqHeader(row[0], "Datum") && eqHeader(row[1], "Bokfört")
      );

      if (isFaktura) {
        // ── Extract month name from "Månad" row for CSV filename ──
        const manadRow = allRows.find((row) => eqHeader(row[0], "Månad"));
        const manad = manadRow
          ? String(manadRow.find((v, i) => i > 0 && v !== "") || "").trim()
          : "";

        // ── Only take rows from the "Köp/uttag" section ──────────
        // The file has two sections:
        //   "Totalt övriga händelser" — contains Inbetalning, Ränta, Saldo (skip)
        //   "Köp/uttag"              — actual purchases and refunds (keep)
        const kopIdx = allRows.findIndex((row) => eqHeader(row[0], "Köp/uttag"));

        // Find column indices from the section's own header row — do NOT hardcode
        let colBelopp = 6;    // Belopp (SEK amount)
        let colUtlBelopp = 5; // Utl. belopp (foreign currency amount)

        const stats = { checked: 0, badDate: 0, badAmount: 0 };
        const tryParseRow = (row: (string | number)[]): (string | number)[] | null => {
          stats.checked++;
          const date = coerceDate(row[0]);
          if (!date) { stats.badDate++; return null; }
          const amount = coerceAmount(row[colBelopp]);
          if (amount === null) { stats.badAmount++; return null; }
          const newRow = [...row];
          newRow[0] = date;
          newRow[colBelopp] = amount;
          const utl = coerceAmount(row[colUtlBelopp]);
          if (utl !== null) newRow[colUtlBelopp] = utl;
          return newRow;
        };

        let txRows: (string | number)[][];
        if (kopIdx >= 0) {
          // Find the Datum/Bokfört header row inside the Köp/uttag section
          const headerIdx = allRows.findIndex(
            (row, i) => i > kopIdx && eqHeader(row[0], "Datum") && eqHeader(row[1], "Bokfört")
          );
          if (headerIdx >= 0) {
            const hRow = allRows[headerIdx];
            const bIdx = hRow.findIndex((h) => eqHeader(h, "Belopp"));
            const uIdx = hRow.findIndex((h) => eqHeader(h, "Utl. belopp"));
            if (bIdx >= 0) colBelopp = bIdx;
            if (uIdx >= 0) colUtlBelopp = uIdx;
          }
          const startIdx = headerIdx >= 0 ? headerIdx + 1 : kopIdx + 2;
          const kopRows = allRows.slice(startIdx)
            .map(tryParseRow)
            .filter((r): r is (string | number)[] => r !== null);

          const firstHeaderIdx = allRows.findIndex(
            (row) => eqHeader(row[0], "Datum") && eqHeader(row[1], "Bokfört")
          );
          const extraChargeRows = (firstHeaderIdx >= 0 && kopIdx > firstHeaderIdx)
            ? allRows.slice(firstHeaderIdx + 1, kopIdx)
                .map(tryParseRow)
                .filter((r): r is (string | number)[] => r !== null)
                .filter((row) => String(row[2] || "").toLowerCase().trim() !== "inbetalning")
            : [];

          txRows = [...extraChargeRows, ...kopRows];
        } else {
          txRows = allRows
            .map(tryParseRow)
            .filter((r): r is (string | number)[] => r !== null)
            .filter((row) => {
              const desc = String(row[2] || "").toLowerCase().trim();
              if (desc === "inbetalning") return false;
              if (desc.startsWith("ränta") || desc.startsWith("dröjsmål")) return false;
              return true;
            });
        }

        if (txRows.length === 0) {
          console.warn("[Faktura XLSX] 0 rows extracted", {
            totalChecked: stats.checked,
            rejectedBadDate: stats.badDate,
            rejectedBadAmount: stats.badAmount,
            colBelopp,
            colUtlBelopp,
            kopIdx,
            sample: allRows.slice(0, 12).map((r, i) => ({
              i, col0: r[0], type0: typeof r[0],
              colBelopp: r[colBelopp], typeBelopp: typeof r[colBelopp],
            })),
          });
        }

        // ── Build normalized CSV for download (semicolon-separated for Swedish Excel) ──
        // Numbers are quoted to prevent Excel from misinterpreting large values as date serials.
        const csvLines = [
          "Datum;Bokfört;Specifikation;Ort;Valuta;Utl. belopp;Belopp SEK",
          ...txRows.map((row) => {
            const esc = (v: string) => `"${v.replace(/"/g, '""')}"`;
            const utlAmt = typeof row[colUtlBelopp] === "number" && row[colUtlBelopp] !== 0
              ? `"${row[colUtlBelopp]}"` : "";
            return [
              String(row[0]),
              String(row[1]),
              esc(String(row[2])),
              esc(String(row[3])),
              String(row[4] || "SEK"),
              utlAmt,
              `"${row[colBelopp]}"`,
            ].join(";");
          }),
        ];
        setFakturaMonth(manad);
        setFakturaCsvData(csvLines.join("\n"));

        // ── Map into the 6-column format used by the import flow ─
        const h = ["Datum", "Bokfört", "Beskrivning", "Ort", "Valuta", "Belopp"];
        const r = txRows.map((row) => [
          String(row[0]),
          String(row[1]),
          String(row[2]),
          String(row[3]),
          String(row[4] || "SEK"),
          String(row[colBelopp]),
        ]);

        const fakturaMapping: CsvColumnMapping = {
          date_column: "Datum",
          date_type: "purchase",
          amount_column: "Belopp",
          amount_sign: "as_is",
          description_column: "Beskrivning",
          id_column: "",
        };

        setHeaders(h);
        setRows(r);
        setIsXlsxFormat(true);
        setMapping(fakturaMapping);
        setSavedMappingLoaded(false);
      } else {
        // Generic XLSX
        setIsXlsxFormat(false);
        const jsonRows = XLSX.utils.sheet_to_json(ws, { defval: "" }) as Record<string, unknown>[];
        if (jsonRows.length === 0) return;
        const h = Object.keys(jsonRows[0]);
        const r = jsonRows.map((row) => h.map((k) => String(row[k] ?? "")));
        setHeaders(h);
        setRows(r);
        const detected = autoDetectMapping(h, r);
        const saved = selectedAccountId ? applySavedIfValid(h, selectedAccountId) : null;
        setMapping(saved ?? detected);
        setSavedMappingLoaded(!!saved);
      }
    };
    reader.readAsArrayBuffer(file);
  };

  // ─── CSV Parser (auto-detects separator) ─────
  const parseCSV = (text: string) => {
    const lines = text.split(/\r?\n/).filter((l) => l.trim());
    if (lines.length < 2) return;

    // Detect separator: whichever of ; , \t gives the most consistent column count
    const candidates: [string, RegExp][] = [
      [";", /;/],
      [",", /,/],
      ["\t", /\t/],
    ];
    const sep = candidates.reduce((best, [s]) => {
      const count = (lines[0].split(s).length + lines[1].split(s).length) / 2;
      const bestCount = (lines[0].split(best).length + lines[1].split(best).length) / 2;
      return count > bestCount ? s : best;
    }, ",");

    const parseLine = (line: string): string[] => {
      if (sep !== ",") return line.split(sep).map((c) => c.trim().replace(/^"|"$/g, ""));
      const result: string[] = [];
      let current = "";
      let inQuotes = false;
      for (const char of line) {
        if (char === '"') { inQuotes = !inQuotes; }
        else if (char === "," && !inQuotes) { result.push(current.trim()); current = ""; }
        else { current += char; }
      }
      result.push(current.trim());
      return result;
    };

    const h = parseLine(lines[0]);
    const r = lines.slice(1).map(parseLine);
    setHeaders(h);
    setRows(r);

    const saved = selectedAccountId ? applySavedIfValid(h, selectedAccountId) : null;
    const detected = autoDetectMapping(h, r);
    setMapping(saved ?? detected);
    setSavedMappingLoaded(!!saved);
  };

  // ─── Smart column auto-detection ─────────────
  const autoDetectMapping = (h: string[], r: string[][]): CsvColumnMapping => {
    const lower = h.map((x) => x.toLowerCase().trim());

    // Swedish and English column name patterns
    const find = (patterns: string[]) =>
      h[lower.findIndex((x) => patterns.some((p) => x.includes(p)))] || "";

    const dateCol = find(["bokföringsdatum", "transaktionsdatum", "datum", "date", "transaction date", "trans date", "posted"]);
    const postedCol = find(["valutadatum", "posted date"]);
    const descCol = find(["text", "description", "beskrivning", "transaktionstext", "memo", "narrative", "details", "payee"]);
    const amtCol = find(["belopp", "amount", "sum", "credit", "debit", "transaction amount"]);
    const idCol = find(["verifikationsnummer", "transaction id", "reference", "id"]);

    // Sign heuristic: if "belopp" or similar Swedish header → bank uses negative for expenses → invert
    const isSwedishFormat = lower.some((x) => ["belopp", "bokföringsdatum", "valutadatum"].includes(x));
    // Also check data: sample first 10 non-empty amounts — if majority are negative, likely needs invert
    let signHeuristic: "as_is" | "invert" = isSwedishFormat ? "invert" : "as_is";
    if (!isSwedishFormat && amtCol) {
      const samples = r.slice(0, 10)
        .map((row) => parseFloat(String(row[h.indexOf(amtCol)] || "").replace(/[^0-9.\-]/g, "")))
        .filter((n) => !isNaN(n));
      const negCount = samples.filter((n) => n < 0).length;
      if (negCount > samples.length * 0.6) signHeuristic = "invert";
    }

    // Date type: if we found a "posted"/"valutadatum" col AND a separate purchase date col → purchase
    const dateType: "purchase" | "posted" = postedCol && postedCol !== dateCol ? "purchase" : "purchase";

    return {
      date_column: dateCol,
      date_type: dateType,
      amount_column: amtCol,
      amount_sign: signHeuristic,
      description_column: descCol,
      id_column: idCol,
    };
  };

  const renderStep1 = () => (
    <div>
      <Select
        label="Target Account"
        value={selectedAccountId}
        onChange={(e) => handleAccountChange(e.target.value)}
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
          {savedMappingLoaded && !isXlsxFormat && (
            <span className="mt-2 px-3 py-1 bg-sq-blue text-sq-white font-sans font-semibold text-[11px] uppercase tracking-wider">
              Saved column mapping loaded
            </span>
          )}
          <input
            type="file"
            accept=".csv,.tsv,.txt,.xlsx,.xls"
            className="hidden"
            multiple
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

          {isXlsxFormat && fakturaCsvData && (
            <div className="mt-4 flex items-center gap-3 p-3 bg-sq-gray-100 border border-sq-black">
              <div className="flex-1">
                <div className="font-sans font-semibold text-[13px] text-sq-black">
                  Normalized CSV ready
                </div>
                <div className="font-sans text-[12px] text-sq-gray-600">
                  {rows.length} transactions from <span className="font-semibold">{fakturaMonth || "this statement"}</span> — Inbetalning &amp; Ränta excluded
                </div>
              </div>
              <button
                onClick={handleDownloadFakturaCSV}
                className="flex items-center gap-1.5 px-3 py-2 border-2 border-sq-black font-sans font-semibold text-[12px] uppercase tracking-wider hover:bg-sq-black hover:text-sq-white transition-colors"
              >
                <Download className="w-3.5 h-3.5" />
                Download {fakturaMonth ? `${fakturaMonth.replace(" ", "-")}.csv` : "CSV"}
              </button>
            </div>
          )}
        </div>
      )}

      {extraFiles.length > 0 && (
        <div className="mb-6">
          <div className="sq-label-muted mb-2">Additional files ({extraFiles.length}) — same mapping will be applied</div>
          <div className="border border-sq-black divide-y divide-sq-gray-100">
            {extraFiles.map((f) => (
              <div key={f.name} className="flex justify-between px-4 py-2 font-sans text-[13px]">
                <span className="font-mono text-sq-black">{f.name}</span>
                <span className="text-sq-gray-600">{f.rows.length} rows</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="flex items-center justify-end gap-4 mt-8">
        {(!selectedAccountId || rows.length === 0) && (
          <span className="font-sans text-[12px] text-sq-gray-600 italic">
            {!selectedAccountId && rows.length === 0
              ? "Select an account and upload a file to continue"
              : !selectedAccountId
                ? "Select an account to continue"
                : "Upload a file with at least one transaction to continue"}
          </span>
        )}
        <Button
          disabled={!selectedAccountId || rows.length === 0}
          onClick={() => (isXlsxFormat || savedMappingLoaded) ? handleCheckDuplicates() : setStep(2)}
        >
          {(isXlsxFormat || savedMappingLoaded) ? "Next: Check Duplicates" : "Next: Column Mapping"}
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
    // Build row objects from first file + all extra files (same headers/mapping)
    const allRowObjs = [
      ...rows.map((row) => {
        const obj: Record<string, string> = { __file__: fileName };
        headers.forEach((h, i) => (obj[h] = row[i] || ""));
        return obj;
      }),
      ...extraFiles.flatMap(({ name, rows: extraRows }) =>
        extraRows.map((row) => {
          const obj: Record<string, string> = { __file__: name };
          headers.forEach((h, i) => (obj[h] = row[i] || ""));
          return obj;
        })
      ),
    ];

    // Fetch existing transactions for this account
    const { data: existing } = await supabase
      .from("transactions")
      .select("*")
      .eq("account_id", selectedAccountId);
    const sensitivity = (() => { try { return localStorage.getItem("sq_dup_sensitivity") || "strict"; } catch { return "strict"; } })();
    const existingFingerprints = new Map<string, Transaction>();
    (existing || []).forEach((t: Transaction) => {
      const fp = sensitivity === "loose"
        ? `${t.date}|${Number(t.amount)}`
        : transactionFingerprint(t.date, Number(t.amount), t.description);
      existingFingerprints.set(fp, t);
    });

    const dupes: typeof duplicates = [];
    const clean: Record<string, string>[] = [];

    for (const rowObj of allRowObjs) {
      const dateStr = rowObj[mapping.date_column] || "";
      const amtStr = rowObj[mapping.amount_column] || "";
      const desc = rowObj[mapping.description_column] || "";
      // Match fullDesc exactly as handleImport stores it (xlsx appends location)
      const location = isXlsxFormat ? (rowObj["Ort"] || "") : "";
      const fullDesc = location ? `${desc} — ${location}` : desc;
      let amt = parseFloat(String(amtStr).replace(/[^0-9.\-]/g, ""));
      if (isNaN(amt)) continue;
      if (mapping.amount_sign === "invert") amt = -amt;
      const parsedDate = new Date(dateStr);
      if (isNaN(parsedDate.getTime())) continue;
      const yr = parsedDate.getUTCFullYear();
      if (yr < 1970 || yr > 2100) {
        console.warn("[Import] skipping row with out-of-range date", { dateStr, year: yr, row: rowObj });
        continue;
      }
      const dateFormatted = parsedDate.toISOString().split("T")[0];
      // Use loose matching if sensitivity is set to "loose" (match on date+amount only)
      const sensitivity = (() => { try { return localStorage.getItem("sq_dup_sensitivity") || "strict"; } catch { return "strict"; } })();
      const fp = sensitivity === "loose"
        ? `${dateFormatted}|${amt}`
        : transactionFingerprint(dateFormatted, amt, fullDesc);

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
                disabled={importing}
                onClick={() => handleImport({ skipAllDuplicates: true })}
              >
                Skip All &amp; Import
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
        <Button variant="ghost" onClick={() => setStep((isXlsxFormat || savedMappingLoaded) ? 1 : 2)}>
          <ArrowLeft className="w-4 h-4" /> Back
        </Button>
        <Button onClick={() => handleImport()} disabled={importing}>
          {importing
            ? (importStatus || "Importing…")
            : `Import ${nonDuplicateRows.length + duplicates.filter((d) => d.action === "import").length} Transactions`}
          <ChevronRight className="w-4 h-4" />
        </Button>
      </div>
    </div>
  );

  // ─── Import Execution ────────────────────────
  const handleImport = async (opts?: { skipAllDuplicates?: boolean }) => {
    setImporting(true);
    setImportStatus("Preparing rows…");
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setImporting(false); return; }

    const skipAll = opts?.skipAllDuplicates === true;
    const toImport = [
      ...nonDuplicateRows,
      ...(skipAll ? [] : duplicates.filter((d) => d.action === "import").map((d) => d.row)),
    ];
    const skipped = skipAll ? duplicates.length : duplicates.filter((d) => d.action === "skip").length;

    // Group rows by source file for per-file batch records
    const fileGroups = new Map<string, Record<string, string>[]>();
    const primaryName = extraFiles.length > 0 ? (toImport[0]?.__file__ || fileName) : fileName;
    for (const row of toImport) {
      const name = row.__file__ || primaryName;
      if (!fileGroups.has(name)) fileGroups.set(name, []);
      fileGroups.get(name)!.push(row);
    }
    // If no __file__ tag (single-file flow), use the primary file name
    if (fileGroups.size === 0) fileGroups.set(fileName, toImport);

    const accountCurrency = accounts.find((a) => a.id === selectedAccountId)?.currency || "SEK";
    const SKIP_DESCRIPTIONS = ["inbetalning"];
    const errors: typeof failedRows = [];
    let totalSuccess = 0;

    const fileEntries = Array.from(fileGroups.entries());
    for (let fi = 0; fi < fileEntries.length; fi++) {
      const [fName, fRows] = fileEntries[fi];
      setImportStatus(`Importing file ${fi + 1}/${fileEntries.length}: ${fName}…`);

      // Create batch record for this file
      const { data: batch } = await supabase
        .from("import_batches")
        .insert({
          user_id: user.id,
          account_id: selectedAccountId,
          file_name: fName,
          file_hash: "",
          raw_row_count: fRows.length,
          imported_count: 0,
          skipped_count: fi === 0 ? skipped : 0,
        })
        .select()
        .single();

      if (!batch) continue;

      const txRows: Record<string, unknown>[] = [];

      for (let i = 0; i < fRows.length; i++) {
        const rowObj = fRows[i];
        try {
          const dateStr = rowObj[mapping.date_column] || "";
          const amtStr = rowObj[mapping.amount_column] || "";
          const desc = rowObj[mapping.description_column] || "";

          if (SKIP_DESCRIPTIONS.some((skip) => desc.toLowerCase().trim() === skip.toLowerCase())) continue;

          const location = isXlsxFormat ? (rowObj["Ort"] || "") : "";
          const fullDesc = location ? `${desc} — ${location}` : desc;
          const postedStr = isXlsxFormat ? (rowObj["Bokfört"] || "") : "";
          let amt = parseFloat(String(amtStr).replace(/[^0-9.\-]/g, ""));
          if (isNaN(amt)) throw new Error("Invalid amount");
          if (mapping.amount_sign === "invert") amt = -amt;
          const parsedDate = new Date(dateStr);
          if (isNaN(parsedDate.getTime())) throw new Error("Invalid date");
          const yr = parsedDate.getUTCFullYear();
          if (yr < 1970 || yr > 2100) throw new Error(`Date out of range (year ${yr}): "${dateStr}"`);
          const dateFormatted = parsedDate.toISOString().split("T")[0];
          let postedFormatted: string | null = null;
          if (postedStr) {
            const pd = new Date(postedStr);
            const py = pd.getUTCFullYear();
            if (!isNaN(pd.getTime()) && py >= 1970 && py <= 2100) {
              postedFormatted = pd.toISOString().split("T")[0];
            }
          }
          const rowCurrency = isXlsxFormat ? "" : (rowObj["Valuta"] || "");

          txRows.push({
            account_id: selectedAccountId,
            import_batch_id: batch.id,
            date: dateFormatted,
            posted_date: postedFormatted || (mapping.date_type === "posted" ? dateFormatted : null),
            amount: amt,
            currency: rowCurrency || accountCurrency,
            description: fullDesc,
            raw_description: desc,
            transaction_type: amt < 0 ? "income" : "expense",
          });
        } catch (err: any) {
          errors.push({ row: i + 1, reason: err.message || "Unknown error" });
        }
      }

      let successCount = txRows.length;
      if (txRows.length > 0) {
        const { error: insertError } = await supabase.from("transactions").insert(txRows);
        if (insertError) { errors.push({ row: 0, reason: `${fName}: ${insertError.message}` }); successCount = 0; }
      }

      await supabase.from("import_batches").update({ imported_count: successCount }).eq("id", batch.id);
      totalSuccess += successCount;

      // Apply auto-rules for this batch
      try {
        const stored = localStorage.getItem("sq_auto_rules");
        const autoRules: { keyword: string; markShared: boolean; markInternalTransfer?: boolean; categoryId: string }[] = stored ? JSON.parse(stored) : [];
        if (autoRules.length > 0 && successCount > 0) {
          const { data: newTxs } = await supabase.from("transactions").select("id, description").eq("import_batch_id", batch.id);
          if (newTxs) {
            for (const rule of autoRules) {
              const kw = rule.keyword.toLowerCase();
              const matchIds = newTxs.filter((tx) => tx.description.toLowerCase().includes(kw)).map((tx) => tx.id);
              if (matchIds.length === 0) continue;
              const patch: Record<string, unknown> = {};
              if (rule.markShared) { patch.is_shared = true; patch.reimbursement_status = "pending"; }
              if (rule.categoryId) patch.category_id = rule.categoryId;
              if (rule.markInternalTransfer) patch.transaction_type = "internal_transfer";
              if (Object.keys(patch).length > 0) await supabase.from("transactions").update(patch).in("id", matchIds);
            }
          }
        }
      } catch { /* ignore */ }

      // Auto-link CC statement to the matching checking-account payment
      // Only for credit-card target accounts. Goal: hide the bill payment from
      // the transactions overview once its individual charges are imported.
      try {
        const targetAccount = accounts.find((a) => a.id === selectedAccountId);
        if (targetAccount?.type === "credit_card" && successCount > 0) {
          const { data: importedTxs } = await supabase
            .from("transactions")
            .select("id, date, amount")
            .eq("import_batch_id", batch.id);

          if (importedTxs && importedTxs.length > 0) {
            const ccTotal = importedTxs.reduce((s, t) => s + Math.abs(Number(t.amount)), 0);
            const lastTxDate = importedTxs.reduce((max, t) => t.date > max ? t.date : max, importedTxs[0].date);

            // Find candidate payments in non-CC accounts:
            //   - account is checking (not credit_card)
            //   - amount > 0 (expense from checking, our convention)
            //   - on/after the last CC transaction in this statement
            //   - within 60 days of last CC transaction
            //   - not already tagged as cc_payment
            const checkingAcctIds = accounts.filter((a) => a.type !== "credit_card").map((a) => a.id);
            if (checkingAcctIds.length > 0) {
              const lastDate = new Date(lastTxDate);
              const sixtyDaysLater = new Date(lastDate);
              sixtyDaysLater.setDate(sixtyDaysLater.getDate() + 60);
              const upper = sixtyDaysLater.toISOString().split("T")[0];

              const { data: candidates } = await supabase
                .from("transactions")
                .select("id, date, amount, description, transaction_type")
                .in("account_id", checkingAcctIds)
                .gt("amount", 0)
                .gte("date", lastTxDate)
                .lte("date", upper)
                .neq("transaction_type", "cc_payment");

              if (candidates && candidates.length > 0) {
                // Best match: closest amount, then closest date
                const scored = candidates.map((c) => {
                  const amtDiff = Math.abs(Math.abs(Number(c.amount)) - ccTotal);
                  const dateDiff = Math.abs(new Date(c.date).getTime() - lastDate.getTime());
                  return { tx: c, amtDiff, dateDiff };
                }).sort((a, b) => a.amtDiff - b.amtDiff || a.dateDiff - b.dateDiff);

                const best = scored[0];
                const tolerance = Math.max(1, ccTotal * 0.01); // 1% or 1 SEK
                if (best.amtDiff <= tolerance) {
                  // Tag the payment
                  await supabase
                    .from("transactions")
                    .update({ transaction_type: "cc_payment" })
                    .eq("id", best.tx.id);

                  // Create or update the bill record
                  const sortedDates = importedTxs.map((t) => t.date).sort();
                  const { data: existingBill } = await supabase
                    .from("credit_card_bills")
                    .select("id")
                    .eq("payment_transaction_id", best.tx.id)
                    .maybeSingle();
                  const billPayload = {
                    user_id: user.id,
                    credit_card_account_id: selectedAccountId,
                    payment_transaction_id: best.tx.id,
                    total_amount: ccTotal,
                    statement_start_date: sortedDates[0],
                    statement_end_date: sortedDates[sortedDates.length - 1],
                    is_exploded: false,
                    import_batch_id: batch.id,
                  };
                  if (existingBill) {
                    await supabase.from("credit_card_bills").update(billPayload).eq("id", existingBill.id);
                  } else {
                    await supabase.from("credit_card_bills").insert(billPayload);
                  }
                }
              }
            }
          }
        }
      } catch (err) {
        console.warn("[Import] CC auto-link failed:", err);
      }
    }

    if (selectedAccountId && !isXlsxFormat) saveMapping(selectedAccountId, mapping, false);

    setImportedCount(totalSuccess);
    setFailedRows(errors);
    setImporting(false);
    setImportStatus("");
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
        <Button variant="secondary" onClick={() => { setStep(1); setCsvText(""); setFileName(""); setHeaders([]); setRows([]); setExtraFiles([]); setSavedMappingLoaded(false); }}>
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

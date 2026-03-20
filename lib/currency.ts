// ─── Exchange rate utility ────────────────────────────────────────────────────
// Uses the free Frankfurter API (https://api.frankfurter.app) for historical rates.
// Rates are cached in localStorage so repeated loads cost zero network calls.

const MEM_CACHE = new Map<string, number>();

function lsKey(from: string, to: string, date: string) {
  return `sq_fx_${date}_${from}_${to}`;
}

/**
 * Fetch the exchange rate for `from → to` on a given ISO date string.
 * Returns 1 if from === to or if the fetch fails.
 */
export async function getRate(from: string, to: string, date: string): Promise<number> {
  if (from === to) return 1;

  const cacheKey = `${date}:${from}:${to}`;
  if (MEM_CACHE.has(cacheKey)) return MEM_CACHE.get(cacheKey)!;

  // Check localStorage (persists across page loads)
  try {
    const stored = localStorage.getItem(lsKey(from, to, date));
    if (stored) {
      const rate = parseFloat(stored);
      if (!isNaN(rate)) {
        MEM_CACHE.set(cacheKey, rate);
        return rate;
      }
    }
  } catch { /* localStorage unavailable (SSR) */ }

  // Fetch from Frankfurter API
  try {
    const res = await fetch(
      `https://api.frankfurter.app/${date}?from=${from}&to=${to}`,
      { cache: "force-cache" }
    );
    if (!res.ok) return 1;
    const data = await res.json();
    const rate: number = data?.rates?.[to];
    if (typeof rate === "number" && rate > 0) {
      MEM_CACHE.set(cacheKey, rate);
      try { localStorage.setItem(lsKey(from, to, date), String(rate)); } catch { /* ignore */ }
      return rate;
    }
  } catch { /* network error */ }

  return 1;
}

/**
 * Build a rate lookup map for a batch of transactions.
 * Returns a Map keyed by `"CURRENCY:YYYY-MM-DD"` → rate (to displayCurrency).
 * Transactions already in displayCurrency are skipped (rate = 1, implicit).
 */
export async function buildRateMap(
  transactions: { currency: string; date: string }[],
  displayCurrency: string
): Promise<Map<string, number>> {
  // Unique pairs that actually need conversion
  const pairs = new Set<string>();
  for (const tx of transactions) {
    if (tx.currency && tx.currency !== displayCurrency) {
      pairs.add(`${tx.currency}:${tx.date}`);
    }
  }

  const entries = await Promise.all(
    Array.from(pairs).map(async (pair) => {
      const [from, date] = pair.split(":");
      const rate = await getRate(from, displayCurrency, date);
      return [pair, rate] as [string, number];
    })
  );

  return new Map(entries);
}

/**
 * Convert an amount to the display currency using a prebuilt rate map.
 */
export function convert(
  amount: number,
  currency: string,
  date: string,
  displayCurrency: string,
  rateMap: Map<string, number>
): number {
  if (!currency || currency === displayCurrency) return amount;
  const rate = rateMap.get(`${currency}:${date}`) ?? 1;
  return amount * rate;
}

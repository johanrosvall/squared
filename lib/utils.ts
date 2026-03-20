// Lightweight clsx — no external dependency needed
export function cn(...inputs: (string | undefined | null | false)[]) {
  return inputs.filter(Boolean).join(" ");
}

export function formatCurrency(
  amount: number,
  currency: string = "USD"
): string {
  const abs = Math.abs(amount);
  const formatted = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
  }).format(abs);
  return amount < 0 ? `-${formatted}` : formatted;
}

export function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function formatDateShort(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

/**
 * Generate a simple fingerprint for duplicate detection.
 * Combines date + amount + normalized description.
 */
export function transactionFingerprint(
  date: string,
  amount: number,
  description: string
): string {
  const normalizedDesc = description.toLowerCase().replace(/\s+/g, " ").trim();
  return `${date}|${amount}|${normalizedDesc}`;
}

/**
 * Get initials from a name (for avatar display).
 */
export function getInitials(name: string): string {
  return name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

/**
 * Compute percentage of total.
 */
export function pct(value: number, total: number): string {
  if (total === 0) return "0%";
  return `${Math.round((value / total) * 100)}%`;
}

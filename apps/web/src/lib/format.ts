/**
 * Money is integer cents server-side; percents are stored ×100 (1800 = 18%).
 * Display formatting lives here so no screen does its own math.
 */

// Default demo currency; the API sends currencyCode on money rows.
const SYMBOLS: Record<string, string> = { INR: "₹", USD: "$", EUR: "€", GBP: "£" };

export function currencySymbol(code: string | undefined | null): string {
  return SYMBOLS[code ?? "INR"] ?? (code ?? "INR") + " ";
}

export function money(cents: number, code?: string | null, opts?: { sign?: boolean }): string {
  const sym = currencySymbol(code);
  const v = Math.abs(cents) / 100;
  const s = v.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const sign = opts?.sign ? (cents > 0 ? "+" : cents < 0 ? "−" : "") : cents < 0 ? "−" : "";
  return `${sign}${sym}${s}`;
}

export function pct(bps100: number): string {
  // percents stored as value*100 (1800 = 18%)
  const v = bps100 / 100;
  return `${v.toLocaleString("en-IN", { maximumFractionDigits: 2 })}%`;
}

export function dateShort(iso: string | Date | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

export function dateTime(iso: string | Date | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function monthShort(ym: string): string {
  // "2026-04" -> "Apr 26"
  const [y, m] = ym.split("-");
  const d = new Date(Number(y), Number(m) - 1, 1);
  return d.toLocaleDateString("en-IN", { month: "short", year: "2-digit" }).replace(" ", " ’");
}

export function dueLabel(iso: string | Date | null | undefined): string {
  if (!iso) return "—";
  const now = new Date();
  const d = new Date(iso);
  const days = Math.round((d.getTime() - now.getTime()) / 86400000);
  if (days < -1) return `${-days}d overdue`;
  if (days <= 0) return "Due now";
  return `Due in ${days}d`;
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");
}

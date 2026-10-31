/**
 * Pricing service — single source of truth for computing taxes + discounts.
 * Used by the billing run (invoice generation) so customer quotes, invoices and
 * portals always show the same numbers.
 *
 * All money = integer cents. Tax rates stored as rate*100 (1800 = 18.00%).
 */

export interface PricingProductLine {
  lineId: number;
  productId: number;
  productName: string;
  variantId?: number | null;
  quantity: number;
  unitPrice: number;
  taxRuleIds: number[];
}

export type PricingDiscount = Pick<
  typeof import('../db/schema.js').discountRules.$inferSelect,
  'id' | 'code' | 'name' | 'kind' | 'value' | 'minPurchase' | 'minQty' | 'scope' | 'productId'
>;

export interface PricingResult {
  lines: Array<{
    lineId: number;
    discount: number;
    taxableBase: number;
    taxTotal: number;
    subtotal: number;
    total: number;
  }>;
  discountsWithDetails: Array<{
    ruleId: number;
    label: string;
    amount: number;
  }>;
  subtotal: number;
  discountTotal: number;
  taxTotal: number;
  total: number;
}

/** rounding: half-up to integer cents (Math.round of positives is fine) */
const pt = (rate: number, base: number) => Math.round((rate / 100) * base) / 100 * 100;

export function priceLines(
  lines: PricingProductLine[],
  discounts: PricingDiscount[],
  taxRates: Map<number, number>, // taxRuleId -> rate (percent*100)
): PricingResult {
  const subtotal = lines.reduce((acc, l) => acc + l.quantity * l.unitPrice, 0);
  const today = new Date().toISOString().slice(0, 10);

  // Filters: only active-looking discounts (dates/limits checked by caller), then
  // guards: minPurchase on whole cart, minQty on the matched quantity.
  const applicable = discounts.filter((d) => {
    if (d.minPurchase > 0 && subtotal < d.minPurchase) return false;
    const matchedQty =
      d.scope === 'product'
        ? lines.filter((l) => l.productId === d.productId).reduce((a, l) => a + l.quantity, 0)
        : lines.reduce((a, l) => a + l.quantity, 0);
    if (d.minQty > 0 && matchedQty < d.minQty) return false;
    void today;
    return true;
  });

  // Allocate product-scope discounts across their product's lines proportionally.
  const lineDiscount = new Map<number, number>();
  const discountsWithDetails: Array<{ ruleId: number; label: string; amount: number }> = [];

  for (const d of applicable) {
    const matchedLines =
      d.scope === 'product' ? lines.filter((l) => l.productId === d.productId) : lines;
    const matchedSubtotal = matchedLines.reduce((a, l) => a + l.quantity * l.unitPrice, 0);
    if (matchedSubtotal === 0) continue;

    let amount =
      d.kind === 'fixed' ? d.value : Math.round((d.value / 10000) * matchedSubtotal);
    // percent value is stored as percent*100 (1000 = 10%), so fraction = value/10_000
    if (amount > matchedSubtotal) amount = matchedSubtotal;

    let remaining = amount;
    for (const l of matchedLines) {
      const share =
        l === matchedLines[matchedLines.length - 1]
          ? remaining
          : Math.round((amount * (l.quantity * l.unitPrice)) / matchedSubtotal);
      const capped = Math.min(share, remaining);
      lineDiscount.set(l.lineId, (lineDiscount.get(l.lineId) ?? 0) + capped);
      remaining -= capped;
      if (remaining <= 0) break;
    }
    discountsWithDetails.push({ ruleId: d.id, label: `${d.code} — ${d.name}`, amount });
  }

  const outLines = lines.map((l) => {
    const lineSub = l.quantity * l.unitPrice;
    const discount = lineDiscount.get(l.lineId) ?? 0;
    const taxable = lineSub - discount;
    const taxTotal = l.taxRuleIds.reduce((acc, id) => {
      const rate = taxRates.get(id);
      if (rate === undefined) return acc;
      // rate is percent*100 → fraction = rate / 10000
      return acc + Math.round((rate / 10000) * taxable);
    }, 0);
    return {
      lineId: l.lineId,
      discount,
      taxableBase: taxable,
      taxTotal,
      subtotal: lineSub,
      total: taxable + taxTotal,
    };
  });

  // pt helper intentionally unused shortcut: (kept for future grouped taxes)
  void pt;

  const discountTotal = discountsWithDetails.reduce((a, d) => a + d.amount, 0);
  const taxTotal = outLines.reduce((a, l) => a + l.taxTotal, 0);
  const total = subtotal - discountTotal + taxTotal;

  return {
    lines: outLines,
    discountsWithDetails,
    subtotal,
    discountTotal,
    taxTotal,
    total: Math.max(0, total),
  };
}

/** next billing date after `from`, aligned by interval (calendar-aware) */
export function addInterval(from: Date, interval: 'daily' | 'weekly' | 'monthly' | 'yearly'): Date {
  const d = new Date(from);
  switch (interval) {
    case 'daily':
      d.setUTCDate(d.getUTCDate() + 1);
      break;
    case 'weekly':
      d.setUTCDate(d.getUTCDate() + 7);
      break;
    case 'monthly':
      d.setUTCMonth(d.getUTCMonth() + 1);
      break;
    case 'yearly':
      d.setUTCFullYear(d.getUTCFullYear() + 1);
      break;
  }
  return d;
}

export function intervalDays(interval: 'daily' | 'weekly' | 'monthly' | 'yearly'): number {
  switch (interval) {
    case 'daily':
      return 1;
    case 'weekly':
      return 7;
    case 'monthly':
      return 30;
    case 'yearly':
      return 365;
  }
}

export const moneyToUi = (cents: number, currency = 'INR'): string =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency, maximumFractionDigits: 2 }).format(
    cents / 100,
  );

/**
 * Billing engine — Scene: "It is billing day... Each one should be created from
 * its subscription... Nothing should be billed twice or skipped."
 *
 * Idempotency: invoices carry (subscription_id, period_start) unique key —
 * running the billing job twice in the same heartbeat cannot double-bill.
 * Snapshot of taxes/discounts/prices is copied into the invoice lines at issue time.
 */
import { and, eq, inArray, lte, or, isNull, sql } from 'drizzle-orm';

import { db } from '../db/client.js';
import {
  customers,
  discountRules,
  invoiceDiscounts,
  invoiceLineTaxes,
  invoiceLines,
  invoices,
  plans,
  products,
  productVariants,
  subscriptionDiscounts,
  subscriptionEvents,
  subscriptionLineTaxes,
  subscriptionLines,
  subscriptions,
  taxRules,
} from '../db/schema.js';
import { nextNumber } from './numbering.service.js';
import { addInterval, priceLines, type PricingDiscount } from './pricing.service.js';
import { AppError } from '../lib/errors.js';

type Interval = 'daily' | 'weekly' | 'monthly' | 'yearly';
const todayStr = () => new Date().toISOString().slice(0, 10);

const TERM_DAYS: Record<string, number> = { immediate: 0, net15: 15, net30: 30, net45: 45 };

/** ------------------------------------------- auto close / renew on expiry */
export async function processExpirations(today = todayStr()): Promise<{ closed: number; renewed: number }> {
  // active or paused subs whose contract has ended
  const due = await db
    .select({ sub: subscriptions, plan: plans, id: subscriptions.id })
    .from(subscriptions)
    .innerJoin(plans, eq(plans.id, subscriptions.planId))
    .where(
      and(
        inArray(subscriptions.status, ['active', 'paused']),
        or(isNull(subscriptions.expiryDate), lte(subscriptions.expiryDate, today))!,
      ),
    );

  let closed = 0;
  let renewed = 0;
  for (const { plan, id } of due) {
    const [sub] = await db.select().from(subscriptions).where(eq(subscriptions.id, id)).limit(1);
    if (!sub) continue;
    const willRenew = plan.autoRenew && sub.autoRenew && sub.expiryDate !== null;
    if (willRenew) {
      const next = addInterval(new Date(sub.expiryDate!), plan.interval as Interval);
      await db
        .update(subscriptions)
        .set({ expiryDate: next.toISOString().slice(0, 10), updatedAt: new Date() })
        .where(eq(subscriptions.id, sub.id));
      await db.insert(subscriptionEvents).values({
        subscriptionId: sub.id,
        type: 'renewed',
        message: `Auto-renewed to ${next.toISOString().slice(0, 10)}`,
      });
      renewed++;
    } else {
      await db
        .update(subscriptions)
        .set({ status: plan.autoCloseAtEnd ? 'closed' : sub.status, updatedAt: new Date() })
        .where(eq(subscriptions.id, sub.id));
      await db.insert(subscriptionEvents).values({
        subscriptionId: sub.id,
        type: 'closed',
        fromStatus: sub.status,
        toStatus: 'closed',
        message: plan.autoCloseAtEnd ? 'Plan ended (auto-close)' : 'Subscription reached its end date',
      });
      closed++;
    }
  }
  return { closed, renewed };
}

/* ------------------------------------------------- invoice generation core */

async function buildInvoiceForSubscription(
  sub: typeof subscriptions.$inferSelect,
  today: string,
  actorId: number,
): Promise<{ created: boolean; invoiceId?: number }> {
  return db.transaction(async (tx) => {
    const periodStart = sub.nextBillingDate!;

    // anti-double-billing: re-check inside the transaction
    const existing = await tx
      .select({ id: invoices.id })
      .from(invoices)
      .where(and(eq(invoices.subscriptionId, sub.id), eq(invoices.periodStart, periodStart)))
      .limit(1);
    if (existing[0]) return { created: false };

    // lines + taxes
    const lines = await tx
      .select({
        line: subscriptionLines,
        productName: products.name,
        variantName: productVariants.optionName,
        variantDelta: productVariants.priceDelta,
      })
      .from(subscriptionLines)
      .innerJoin(products, eq(products.id, subscriptionLines.productId))
      .leftJoin(productVariants, eq(productVariants.id, subscriptionLines.variantId))
      .where(eq(subscriptionLines.subscriptionId, sub.id));

    const lineIds = lines.map((l) => l.line.id);
    const taxes = lineIds.length
      ? await tx
          .select({ lineId: subscriptionLineTaxes.lineId, rate: taxRules.rate, name: taxRules.name, ruleId: taxRules.id })
          .from(subscriptionLineTaxes)
          .innerJoin(taxRules, eq(taxRules.id, subscriptionLineTaxes.taxRuleId))
          .where(
            inArray(
              subscriptionLineTaxes.lineId,
              lineIds,
            ),
          )
      : [];

    const taxRates = new Map<number, number>();
    const taxByLine = new Map<number, number[]>();
    const taxRuleName = new Map<number, string>();
    for (const t of taxes) {
      taxRates.set(t.ruleId, t.rate);
      taxByLine.set(t.lineId, [...(taxByLine.get(t.lineId) ?? []), t.ruleId]);
      taxRuleName.set(t.ruleId, t.name);
    }

    // auto-applied discounts valid today: subscription-scope attached to this sub,
    // product-scope matching this subscription's products
    const subRules = await tx
      .select({ rule: discountRules })
      .from(subscriptionDiscounts)
      .innerJoin(discountRules, eq(discountRules.id, subscriptionDiscounts.ruleId))
      .where(eq(subscriptionDiscounts.subscriptionId, sub.id));

    const allRules = [
      ...subRules.map((r) => r.rule),
      ...(
        await tx
          .select()
          .from(discountRules)
          .where(
            sql`${discountRules.scope} = 'product' AND ${discountRules.isActive} AND ${discountRules.startsAt} <= ${today} AND (${discountRules.endsAt} IS NULL OR ${discountRules.endsAt} >= ${today}) AND (CASE WHEN ${discountRules.maxUses} IS NULL THEN true ELSE ${discountRules.usedCount} < ${discountRules.maxUses} END) AND ${discountRules.productId} IN (SELECT product_id FROM subscription_lines WHERE subscription_id = ${sub.id})`,
          )
      ),
    ];

    const priced = priceLines(
      lines.map((l) => ({
        lineId: l.line.id,
        productId: l.line.productId,
        productName: l.productName,
        variantId: l.line.variantId,
        quantity: l.line.quantity,
        unitPrice: l.line.unitPrice, // final price (variant delta already in the stored line)
        taxRuleIds: taxByLine.get(l.line.id) ?? [],
      })),
      allRules as PricingDiscount[],
      taxRates,
    );

    const number = await nextNumber('invoice');
    const periodEnd = addInterval(new Date(periodStart), (await tx.select().from(plans).where(eq(plans.id, sub.planId)).limit(1))[0]!.interval as Interval);
    const periodEndStr = new Date(periodEnd.getTime() - 24 * 3600 * 1000).toISOString().slice(0, 10);
    const dueDate = new Date(today);
    dueDate.setUTCDate(dueDate.getUTCDate() + (TERM_DAYS[sub.paymentTerms] ?? 15));

    const [invoice] = await tx
      .insert(invoices)
      .values({
        number,
        subscriptionId: sub.id,
        customerId: sub.customerId,
        status: 'draft',
        issueDate: today,
        dueDate: dueDate.toISOString().slice(0, 10),
        periodStart,
        periodEnd: periodEndStr,
        subtotal: priced.subtotal,
        discountTotal: priced.discountTotal,
        taxTotal: priced.taxTotal,
        total: priced.total,
      })
      .returning({ id: invoices.id });
    const invoiceId = invoice!.id;

    for (const l of lines) {
      const p = priced.lines.find((pl) => pl.lineId === l.line.id)!;
      const [invLine] = await tx
        .insert(invoiceLines)
        .values({
          invoiceId,
          productId: l.line.productId,
          variantId: l.line.variantId,
          description: l.productName + (l.variantName ? ` (${l.variantName})` : ''),
          quantity: l.line.quantity,
          // subscription line unit price is the FINAL price (variant deltas already applied)
          unitPrice: l.line.unitPrice,
          taxTotal: p.taxTotal,
          subtotal: p.subtotal,
          total: p.total,
        })
        .returning({ id: invoiceLines.id });
      const lineTaxIds = taxByLine.get(l.line.id) ?? [];
      if (lineTaxIds.length > 0) {
        await tx
          .insert(invoiceLineTaxes)
          .values(lineTaxIds.map((tid) => ({ lineId: invLine!.id, taxRuleId: tid, rate: taxRates.get(tid) ?? 0 })));
      }
    }

    for (const d of priced.discountsWithDetails) {
      await tx.insert(invoiceDiscounts).values({
        invoiceId,
        ruleId: d.ruleId,
        label: d.label,
        amount: d.amount,
      });
    }

    // advance the subscription's billing cursor
    const planRow = (await tx.select().from(plans).where(eq(plans.id, sub.planId)).limit(1))[0]!;
    const nextBill = addInterval(new Date(periodStart), planRow.interval as Interval);
    await tx
      .update(subscriptions)
      .set({ lastBillingDate: periodStart, nextBillingDate: nextBill.toISOString().slice(0, 10), updatedAt: new Date() })
      .where(eq(subscriptions.id, sub.id));

    await tx.insert(subscriptionEvents).values({
      subscriptionId: sub.id,
      type: 'invoiced',
      message: `Invoice ${number} generated (${(priced.total / 100).toFixed(2)})`,
      actorId,
    });

    return { created: true, invoiceId };
  });
}

/* ------------------------------------------------------------- the run */

export interface BillingRunResult {
  ranOn: string;
  dueCount: number;
  created: number;
  skipped: number;
  renewed: number;
  closed: number;
}

export async function runBilling(actorId: number, today = todayStr()): Promise<BillingRunResult> {
  const exp = await processExpirations(today);

  const due = await db
    .select({ sub: subscriptions })
    .from(subscriptions)
    .innerJoin(plans, eq(plans.id, subscriptions.planId))
    .where(
      and(
        eq(subscriptions.status, 'active'),
        eq(plans.isActive, true),
        lte(subscriptions.nextBillingDate, today),
      ),
    );

  let created = 0;
  let skipped = 0;
  for (const { sub } of due) {
    const res = await buildInvoiceForSubscription(sub, today, actorId);
    if (res.created) created++;
    else skipped++;
  }

  return { ranOn: today, dueCount: due.length, created, skipped, renewed: exp.renewed, closed: exp.closed };
}

/** ad-hoc "bill now" for a subscription (runs the same core, single row) */
export async function billNow(subscriptionId: number, actorId: number): Promise<{ created: boolean }> {
  const [sub] = await db.select().from(subscriptions).where(eq(subscriptions.id, subscriptionId)).limit(1);
  if (!sub) throw new AppError('not_found', 'Subscription not found.');
  if (sub.status !== 'active') {
    throw new AppError('conflict', `Only active subscriptions can be billed (currently ${sub.status}).`);
  }
  if (!sub.nextBillingDate || sub.nextBillingDate > todayStr()) {
    throw new AppError('conflict', `Nothing due yet — next billing date is ${sub.nextBillingDate}.`);
  }
  return buildInvoiceForSubscription(sub, todayStr(), actorId);
}

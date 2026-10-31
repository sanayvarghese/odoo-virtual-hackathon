/**
 * Subscription lifecycle (Scene: "Draft → Quotation → Confirmed → Active → Closed").
 * All transitions funnel through the FSM below — illegal ones are rejected with a
 * clear error (409) instead of silently changing state.
 */
import { and, eq, inArray } from 'drizzle-orm';

import { db, type Tx } from '../db/client.js';
import {
  customers,
  discountRules,
  plans,
  products,
  productVariants,
  quoteTemplateLines,
  quoteTemplates,
  subscriptionDiscounts,
  subscriptionEvents,
  subscriptionLineTaxes,
  subscriptionLines,
  subscriptions,
} from '../db/schema.js';
import { AppError, businessRule } from '../lib/errors.js';
import { nextNumber } from './numbering.service.js';
import { addInterval } from './pricing.service.js';

const today = () => new Date().toISOString().slice(0, 10);

type Interval = 'daily' | 'weekly' | 'monthly' | 'yearly';

/* ---------------------------------------------------------------- FSM */

const ALLOWED: Record<string, string[]> = {
  draft: ['quotation', 'cancelled'],
  quotation: ['confirmed', 'cancelled'],
  confirmed: ['active', 'cancelled'],
  active: ['paused', 'closed', 'cancelled'],
  paused: ['active', 'closed', 'cancelled'],
  closed: [],
  cancelled: [],
};

export interface CreateSubscriptionInput {
  customerId: number;
  planId: number;
  templateId?: number;
  startDate: string;
  paymentTerms?: 'immediate' | 'net15' | 'net30' | 'net45';
  quantity: number;
  notes?: string;
  autoRenew?: boolean;
  /** explicit line overrides; falls back to template lines, else plan price */
  lines?: Array<{
    productId: number;
    variantId?: number | null;
    planId?: number | null;
    quantity: number;
    unitPrice: number;
    taxRuleIds: number[];
  }>;
  discountIds?: number[];
  actorId: number;
}

export async function createSubscription(input: CreateSubscriptionInput): Promise<number> {
  const [plan] = await db.select().from(plans).where(eq(plans.id, input.planId)).limit(1);
  if (!plan) throw new AppError('validation_error', 'Select a valid plan.');
  if (!plan.isActive) throw new AppError('validation_error', 'This plan is no longer active.');
  // Scene: "the dates it is available"
  if (input.startDate < plan.validFrom) {
    throw businessRule(`This plan is available from ${plan.validFrom}.`);
  }
  if (plan.validTo && input.startDate > plan.validTo) {
    throw businessRule(`This plan stopped being available on ${plan.validTo}.`);
  }
  const quantity = Math.max(input.quantity, plan.minQty);
  if (input.quantity < plan.minQty) {
    // Scene: "the minimum quantity"
    throw businessRule(`Plan "${plan.name}" requires a minimum quantity of ${plan.minQty}.`);
  }
  const [customer] = await db.select({ id: customers.id }).from(customers).where(eq(customers.id, input.customerId)).limit(1);
  if (!customer) throw new AppError('validation_error', 'Select a valid customer.');

  // validity window for quotations created from a template
  let validUntil: string | null = null;
  if (input.templateId) {
    const [tpl] = await db.select().from(quoteTemplates).where(eq(quoteTemplates.id, input.templateId)).limit(1);
    if (!tpl) throw new AppError('validation_error', 'Quotation template not found.');
    const d = new Date();
    d.setUTCDate(d.getUTCDate() + tpl.validDays);
    validUntil = d.toISOString().slice(0, 10);
  }

  const number = await nextNumber('subscription');
  const id = await db.transaction(async (tx) => {
    const [sub] = await tx
      .insert(subscriptions)
      .values({
        number,
        customerId: input.customerId,
        planId: plan.id,
        templateId: input.templateId ?? null,
        paymentTerms: input.paymentTerms ?? 'net15',
        quantity,
        status: 'draft',
        startDate: input.startDate,
        expiryDate: null, // set on activation (one full term)
        nextBillingDate: quantity > 0 ? input.startDate : input.startDate,
        autoRenew: input.autoRenew ?? plan.autoRenew,
        notes: input.notes ?? null,
        validUntil,
        createdBy: input.actorId,
      })
      .returning({ id: subscriptions.id });
    const subId = sub!.id;

    // lines: explicit > template > plan default
    let lines = input.lines;
    if (!lines && input.templateId) {
      const tplLines = await tx.select().from(quoteTemplateLines).where(eq(quoteTemplateLines.templateId, input.templateId));
      lines = tplLines.map((l) => ({
        productId: l.productId,
        variantId: l.variantId,
        planId: l.planId,
        quantity: l.quantity,
        unitPrice: l.unitPrice,
        taxRuleIds: [],
      }));
    }
    if (!lines || lines.length === 0) {
      lines = [
        { productId: plan.productId, variantId: plan.variantId, planId: plan.id, quantity, unitPrice: plan.price, taxRuleIds: [] },
      ];
    }
    for (const l of lines) {
      const [line] = await tx
        .insert(subscriptionLines)
        .values({
          subscriptionId: subId,
          productId: l.productId,
          variantId: l.variantId ?? null,
          planId: l.planId ?? null,
          quantity: l.quantity,
          unitPrice: l.unitPrice,
        })
        .returning({ id: subscriptionLines.id });
      if (l.taxRuleIds.length > 0) {
        await tx.insert(subscriptionLineTaxes).values(
          l.taxRuleIds.map((tid) => ({ lineId: line!.id, taxRuleId: tid })),
        );
      }
    }

    if (input.discountIds?.length) await applyDiscounts(tx, subId, input.discountIds);

    await tx.insert(subscriptionEvents).values({
      subscriptionId: subId,
      type: 'created',
      toStatus: 'draft',
      actorId: input.actorId,
      message: input.templateId ? 'Created from quotation template' : 'Created as draft',
    });
    return subId;
  });
  return id;
}

async function applyDiscounts(tx: Tx, subscriptionId: number, ruleIds: number[]) {
  const rules = await tx
    .select({ id: discountRules.id, scope: discountRules.scope })
    .from(discountRules)
    .where(inArray(discountRules.id, ruleIds));
  const subScope = rules.filter((r) => r.scope === 'subscription').map((r) => r.id);
  if (subScope.length > 0) {
    await tx
      .insert(subscriptionDiscounts)
      .values(subScope.map((ruleId) => ({ subscriptionId, ruleId })))
      .onConflictDoNothing();
  }
  // product-scope discounts attach per line at billing time (by productId)
  return rules;
}

/* ----------------------------------------------------------- transitions */

async function loadWithPlan(id: number) {
  const [sub] = await db.select().from(subscriptions).where(eq(subscriptions.id, id)).limit(1);
  if (!sub) throw new AppError('not_found', 'Subscription not found.');
  const [plan] = await db.select().from(plans).where(eq(plans.id, sub.planId)).limit(1);
  if (!plan) throw new AppError('not_found', 'Plan not found (referenced by subscription).');
  return { sub, plan };
}

export async function transition(
  id: number,
  to: 'quotation' | 'confirmed' | 'active' | 'paused' | 'closed' | 'cancelled',
  actorId: number,
  message?: string,
) {
  const { sub, plan } = await loadWithPlan(id);

  if (!ALLOWED[sub.status]?.includes(to)) {
    throw new AppError('conflict', `This subscription is ${sub.status}; it cannot move to ${to}.`);
  }

  // Plan-flag guards (Scene: "The admin decides which, plan by plan")
  if (to === 'paused' && !plan.allowPause) {
    throw businessRule(`Plan "${plan.name}" does not allow pausing.`);
  }
  if (to === 'cancelled' && sub.status === 'active' && !plan.allowEarlyCancel) {
    throw businessRule(`Plan "${plan.name}" does not allow cancelling before the term ends.`);
  }

  const updates: Partial<typeof subscriptions.$inferInsert> = { status: to, updatedAt: new Date() };

  if (to === 'quotation') {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() + 30);
    updates.validUntil = sub.validUntil ?? d.toISOString().slice(0, 10);
  }
  if (to === 'active') {
    // start the clock: first billing at start date, expiry = one full term
    updates.nextBillingDate = sub.startDate;
    const expiry = addInterval(new Date(sub.startDate), plan.interval as Interval);
    updates.expiryDate = expiry.toISOString().slice(0, 10);
  }

  await db.transaction(async (tx) => {
    await tx.update(subscriptions).set(updates).where(eq(subscriptions.id, id));
    await tx.insert(subscriptionEvents).values({
      subscriptionId: id,
      type: to,
      fromStatus: sub.status,
      toStatus: to,
      actorId,
      message: message ?? null,
    });
  });
  return { status: to };
}

export async function listSubscriptionEvents(id: number) {
  return db
    .select()
    .from(subscriptionEvents)
    .where(eq(subscriptionEvents.subscriptionId, id))
    .orderBy(subscriptionEvents.at);
}

/* --------------------------------------------------------------- helpers */

export async function subscriptionFull(id: number) {
  const [sub] = await db.select().from(subscriptions).where(eq(subscriptions.id, id)).limit(1);
  if (!sub) throw new AppError('not_found', 'Subscription not found.');
  const [plan] = await db.select().from(plans).where(eq(plans.id, sub.planId)).limit(1);
  const lines = await db
    .select({
      line: subscriptionLines,
      productName: products.name,
      productSku: products.sku,
      variantName: productVariants.optionName,
      variantDelta: productVariants.priceDelta,
    })
    .from(subscriptionLines)
    .innerJoin(products, eq(products.id, subscriptionLines.productId))
    .leftJoin(productVariants, eq(productVariants.id, subscriptionLines.variantId))
    .where(eq(subscriptionLines.subscriptionId, id));
  const discounts = await db
    .select({ rule: discountRules })
    .from(subscriptionDiscounts)
    .innerJoin(discountRules, eq(discountRules.id, subscriptionDiscounts.ruleId))
    .where(eq(subscriptionDiscounts.subscriptionId, id));
  const events = await listSubscriptionEvents(id);
  const [customer] = await db.select().from(customers).where(eq(customers.id, sub.customerId)).limit(1);
  return {
    ...sub,
    plan: plan ?? null,
    customer: customer ?? null,
    lines: lines.map((l) => ({
      ...l.line,
      productName: l.productName,
      productSku: l.productSku,
      variantName: l.variantName,
      variantDelta: l.variantDelta,
    })),
    discounts: discounts.map((d) => d.rule),
    events,
  };
}

/** Draft-stage line edit (only before confirm) */
export async function replaceLines(id: number, lines: CreateSubscriptionInput['lines']) {
  const { sub } = await loadWithPlan(id);
  if (!['draft', 'quotation'].includes(sub.status)) {
    throw businessRule('Lines can only be edited while the subscription is a draft or quotation.');
  }
  if (!lines) return;
  await (async () => {
    await db.transaction(async (tx) => {
      await tx.delete(subscriptionLines).where(eq(subscriptionLines.subscriptionId, id));
      for (const l of lines) {
        const [line] = await tx
          .insert(subscriptionLines)
          .values({
            subscriptionId: id,
            productId: l.productId,
            variantId: l.variantId ?? null,
            planId: l.planId ?? null,
            quantity: l.quantity,
            unitPrice: l.unitPrice,
          })
          .returning({ id: subscriptionLines.id });
        if (l.taxRuleIds.length > 0) {
          await tx
            .insert(subscriptionLineTaxes)
            .values(l.taxRuleIds.map((tid) => ({ lineId: line!.id, taxRuleId: tid })));
        }
      }
    });
  })();
}

export const fsmSummary = ALLOWED;

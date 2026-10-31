import type { FastifyInstance } from 'fastify';
import { and, count, desc, eq, gte, ilike, inArray, lte, sql } from 'drizzle-orm';
import { z } from 'zod';

import { db } from '../db/client.js';
import {
  customers,
  discountRules,
  discountUsages,
  invoiceDiscounts,
  invoiceLineTaxes,
  invoiceLines,
  invoices,
  payments,
  products,
  subscriptions,
} from '../db/schema.js';
import { requireAuth, requireRole, requireAuthHook } from '../plugins/auth.js';
import { AppError, idParamSchema, pageSchema, parseOrThrow } from '../lib/route-helpers.js';
import { isoDate } from '../lib/validators.js';

export default async function invoiceRoutes(app: FastifyInstance) {
  /* ------------------------------------------------------------------ list */
  app.get('/', { schema: { tags: ['invoices'] }, preHandler: requireAuthHook }, async (req) => {
    const user = requireAuth(req);
    const query = (req.query ?? {}) as Record<string, string | undefined>;
    const { q, page, limit } = pageSchema.parse(req.query ?? {});

    const conditions = [];
    if (query.status) conditions.push(inArray(invoices.status, String(query.status).split(',') as never[]));
    if (query.overdue === 'true') conditions.push(lte(invoices.dueDate, sql`CURRENT_DATE - 0::int`), sql`${invoices.status} = 'confirmed'`);
    if (query.from) conditions.push(gte(invoices.issueDate, isoDate.parse(query.from)));
    if (query.to) conditions.push(lte(invoices.issueDate, isoDate.parse(query.to)));
    if (query.customerId) conditions.push(eq(invoices.customerId, Number(query.customerId)));

    // customer portal: only own invoices
    if (user.role === 'customer') {
      const mine = await db.select({ id: customers.id }).from(customers).where(eq(customers.userId, user.id)).limit(1);
      if (!mine[0]) return { items: [], page, limit, total: 0 };
      conditions.push(eq(invoices.customerId, mine[0].id));
    }
    if (q) conditions.push(ilike(invoices.number, `%${q}%`));
    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const [rows, totalRows] = await Promise.all([
      db
        .select({
          id: invoices.id,
          number: invoices.number,
          status: invoices.status,
          issueDate: invoices.issueDate,
          dueDate: invoices.dueDate,
          periodStart: invoices.periodStart,
          periodEnd: invoices.periodEnd,
          total: invoices.total,
          paidTotal: invoices.paidTotal,
          customerName: customers.companyName,
          subscriptionNumber: subscriptions.number,
        })
        .from(invoices)
        .innerJoin(customers, eq(customers.id, invoices.customerId))
        .leftJoin(subscriptions, eq(subscriptions.id, invoices.subscriptionId))
        .where(where)
        .orderBy(desc(invoices.issueDate), desc(invoices.id))
        .limit(limit)
        .offset((page - 1) * limit),
      db
        .select({ total: count() })
        .from(invoices)
        .innerJoin(customers, eq(customers.id, invoices.customerId))
        .where(where),
    ]);
    return { items: rows, page, limit, total: totalRows[0]?.total ?? 0 };
  });

  /* ------------------------------------------------------------------- get */
  app.get('/:id', { schema: { tags: ['invoices'] }, preHandler: requireAuthHook }, async (req) => {
    const { id } = idParamSchema.parse(req.params);
    const user = requireAuth(req);
    const [inv] = await db.select().from(invoices).where(eq(invoices.id, id)).limit(1);
    if (!inv) throw new AppError('not_found', 'Invoice not found.');
    if (user.role === 'customer') {
      const mine = await db.select({ id: customers.id }).from(customers).where(eq(customers.userId, user.id)).limit(1);
      if (!mine[0] || inv.customerId !== mine[0].id) {
        throw new AppError('forbidden', 'You can only view your own invoices.');
      }
    }
    const [lines, discounts, paidRows, customer] = await Promise.all([
      db
        .select({ line: invoiceLines, taxRuleId: invoiceLineTaxes.taxRuleId, rate: invoiceLineTaxes.rate })
        .from(invoiceLines)
        .leftJoin(invoiceLineTaxes, eq(invoiceLineTaxes.lineId, invoiceLines.id))
        .where(eq(invoiceLines.invoiceId, id)),
      db.select().from(invoiceDiscounts).where(eq(invoiceDiscounts.invoiceId, id)),
      db.select().from(payments).where(eq(payments.invoiceId, id)).orderBy(desc(payments.paidAt)),
      db
        .select({ customer: customers, email: sql<string>`u.email` })
        .from(customers)
        .leftJoin(sql`users u`, sql`u.id = ${customers.userId}`)
        .where(eq(customers.id, inv.customerId))
        .limit(1),
    ]);
    // assemble lines (taxes are duplicated per line in the join)
    const byLine = new Map<number, unknown>();
    for (const row of lines) {
      const existing = byLine.get(row.line.id) as { line: typeof invoiceLines.$inferSelect; taxes: Array<{ name?: string; rate: number }> } | undefined;
      if (!existing) {
        byLine.set(row.line.id, { line: row.line, taxes: row.taxRuleId ? [{ rate: row.rate ?? 0 }] : [] });
      } else if (row.taxRuleId) {
        existing.taxes.push({ rate: row.rate ?? 0 });
      }
    }
    return {
      invoice: inv,
      lines: [...byLine.values()],
      discounts,
      payments: paidRows,
      customer: customer[0] ?? null,
    };
  });

  /* --------------------------------------------------------------- confirm */
  app.post('/:id/confirm', { schema: { tags: ['invoices'] }, preHandler: requireRole('admin', 'staff') }, async (req) => {
    req.csrfValidate();
    const { id } = idParamSchema.parse(req.params);
    const user = requireAuth(req);
    const [inv] = await db.select().from(invoices).where(eq(invoices.id, id)).limit(1);
    if (!inv) throw new AppError('not_found', 'Invoice not found.');
    if (inv.status !== 'draft') {
      throw new AppError('conflict', `Only draft invoices can be confirmed (current: ${inv.status}).`);
    }
    await db.transaction(async (tx) => {
      await tx.update(invoices).set({ status: 'confirmed', updatedAt: new Date() }).where(eq(invoices.id, id));
      // register discount usage at confirm time (not on draft/cancel — a cancelled
      // invoice never actually applies the discount)
      const applied = await tx.select().from(invoiceDiscounts).where(eq(invoiceDiscounts.invoiceId, id));
      for (const d of applied) {
        if (d.ruleId) {
          await tx.update(discountRules).set({ usedCount: sql`${discountRules.usedCount} + 1` }).where(eq(discountRules.id, d.ruleId));
          await tx.insert(discountUsages).values({
            ruleId: d.ruleId,
            subscriptionId: inv.subscriptionId,
            invoiceId: inv.id,
          });
        }
      }
    });
    return { ok: true, status: 'confirmed' };
  });

  /* ----------------------------------------------------------------- send */
  app.post('/:id/send', { schema: { tags: ['invoices'] }, preHandler: requireRole('admin', 'staff') }, async (req) => {
    req.csrfValidate();
    const { id } = idParamSchema.parse(req.params);
    const { sendMessage } = await import('../lib/mailbox.js');
    const [inv] = await db
      .select({
        number: invoices.number,
        total: invoices.total,
        dueDate: invoices.dueDate,
        email: sql<string>`u.email`,
        company: customers.companyName,
      })
      .from(invoices)
      .innerJoin(customers, eq(customers.id, invoices.customerId))
      .innerJoin(sql`users u`, sql`u.id = ${customers.userId}`)
      .where(eq(invoices.id, id))
      .limit(1);
    if (!inv) throw new AppError('not_found', 'Invoice not found.');
    await sendMessage(
      inv.email,
      `Invoice ${inv.number} from Brightloop Software`,
      `Hello ${inv.company},\n\nInvoice ${inv.number} for ${inv.total ? (inv.total / 100).toFixed(2) : '0.00'} is now viewable in your Brightloop portal.\nDue date: ${inv.dueDate ?? 'on receipt'}.\n\n— Brightloop Billing`,
    );
    await db.update(invoices).set({ sentAt: new Date() }).where(eq(invoices.id, id));
    return { ok: true, message: 'Invoice emailed (dev mailbox in this environment).' };
  });

  /* --------------------------------------------------------------- cancel */
  app.post('/:id/cancel', { schema: { tags: ['invoices'] }, preHandler: requireRole('admin', 'staff') }, async (req) => {
    req.csrfValidate();
    const { id } = idParamSchema.parse(req.params);
    const [inv] = await db.select().from(invoices).where(eq(invoices.id, id)).limit(1);
    if (!inv) throw new AppError('not_found', 'Invoice not found.');
    if (inv.status === 'paid') throw new AppError('conflict', 'A paid invoice cannot be cancelled. Record a refund instead.');
    if (inv.paidTotal > 0) throw new AppError('conflict', 'This invoice has payments recorded against it.');
    await db.update(invoices).set({ status: 'cancelled', updatedAt: new Date() }).where(eq(invoices.id, id));
    return { ok: true };
  });

  /* ------------------------------------------------------- upcoming (portal) */
  app.get('/next/for-subscription/:subscriptionId', { schema: { tags: ['invoices'] }, preHandler: requireAuthHook }, async (req) => {
    const params = parseOrThrow(z.object({ subscriptionId: z.coerce.number().int().positive() }), req.params);
    const user = requireAuth(req);
    const [sub] = await db.select().from(subscriptions).where(eq(subscriptions.id, params.subscriptionId)).limit(1);
    if (!sub) throw new AppError('not_found', 'Subscription not found.');
    if (user.role === 'customer') {
      const mine = await db.select({ id: customers.id }).from(customers).where(eq(customers.userId, user.id)).limit(1);
      if (!mine[0] || sub.customerId !== mine[0].id) {
        throw new AppError('forbidden', 'You can only view your own subscriptions.');
      }
    }
    return {
      nextBillingDate: sub.nextBillingDate,
      lastBillingDate: sub.lastBillingDate,
      status: sub.status,
    };
  });
}

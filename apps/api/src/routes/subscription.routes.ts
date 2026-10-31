import type { FastifyInstance } from 'fastify';
import { and, asc, desc, eq, ilike, or, sql, inArray, count } from 'drizzle-orm';
import { z } from 'zod';

import { db } from '../db/client.js';
import {
  customers,
  discountRules,
  plans,
  products,
  subscriptionDiscounts,
  subscriptionLineTaxes,
  subscriptionLines,
  subscriptions,
  users,
} from '../db/schema.js';
import { requireAuth, requireRole, requireAuthHook } from '../plugins/auth.js';
import { AppError, idParamSchema, pageSchema, parseOrThrow } from '../lib/route-helpers.js';
import { cents, } from '../lib/common-validators.js';
import { quantitySchema } from '../lib/validators.js';
import { isoDate } from '../lib/validators.js';
import * as svc from '../services/subscription.service.js';
import { billNow } from '../services/billing.service.js';

const lineSchema = z.object({
  productId: z.number().int().positive(),
  variantId: z.number().int().positive().nullable().optional(),
  planId: z.number().int().positive().nullable().optional(),
  quantity: quantitySchema,
  unitPrice: cents('Unit price'),
  taxRuleIds: z.array(z.number().int().positive()).default([]),
});

const createSchema = z.object({
  customerId: z.number().int().positive({ error: 'Choose a customer.' }),
  planId: z.number().int().positive({ error: 'Choose a plan.' }),
  templateId: z.number().int().positive().optional(),
  startDate: isoDate,
  paymentTerms: z.enum(['immediate', 'net15', 'net30', 'net45']).default('net15'),
  quantity: quantitySchema.default(1),
  notes: z.string().trim().max(2000).optional(),
  autoRenew: z.boolean().optional(),
  lines: z.array(lineSchema).optional(),
  discountIds: z.array(z.number().int().positive()).default([]),
});

const transitionSchema = z.object({
  to: z.enum(['quotation', 'confirmed', 'active', 'paused', 'closed', 'cancelled']),
  message: z.string().trim().max(500).optional(),
});

export default async function subscriptionRoutes(app: FastifyInstance) {
  /* ------------------------------------------------------------------ list */
  app.get('/', { schema: { tags: ['subscriptions'] }, preHandler: requireAuthHook }, async (req) => {
    const user = requireAuth(req);
    const query = (req.query ?? {}) as Record<string, string | undefined>;
    const { q, page, limit } = pageSchema.parse(req.query ?? {});

    const conditions = [];
    const statusFilter = query.status ? String(query.status).split(',') : null;
    if (statusFilter) conditions.push(inArray(subscriptions.status, statusFilter as never[]));

    let customerScope: number[] | null = null;
    if (user.role === 'customer') {
      const mine = await db.select({ id: customers.id }).from(customers).where(eq(customers.userId, user.id)).limit(1);
      if (!mine[0]) return { items: [], page, limit, total: 0 };
      customerScope = [mine[0].id];
    } else if (query.customerId) {
      customerScope = [Number(query.customerId)];
    }
    if (customerScope) conditions.push(inArray(subscriptions.customerId, customerScope));
    if (q) {
      conditions.push(
        or(ilike(subscriptions.number, `%${q}%`), ilike(customers.companyName, `%${q}%`)),
      );
    }
    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const [rows, totalRows] = await Promise.all([
      db
        .select({
          id: subscriptions.id,
          number: subscriptions.number,
          status: subscriptions.status,
          quantity: subscriptions.quantity,
          startDate: subscriptions.startDate,
          expiryDate: subscriptions.expiryDate,
          nextBillingDate: subscriptions.nextBillingDate,
          paymentTerms: subscriptions.paymentTerms,
          autoRenew: subscriptions.autoRenew,
          createdAt: subscriptions.createdAt,
          customerName: customers.companyName,
          planName: plans.name,
          planInterval: plans.interval,
        })
        .from(subscriptions)
        .innerJoin(customers, eq(customers.id, subscriptions.customerId))
        .innerJoin(plans, eq(plans.id, subscriptions.planId))
        .where(where)
        .orderBy(desc(subscriptions.createdAt))
        .limit(limit)
        .offset((page - 1) * limit),
      db
        .select({ total: count() })
        .from(subscriptions)
        .innerJoin(customers, eq(customers.id, subscriptions.customerId))
        .where(where),
    ]);
    return { items: rows, page, limit, total: totalRows[0]?.total ?? 0 };
  });

  /* ------------------------------------------------------------------- get */
  app.get('/:id', { schema: { tags: ['subscriptions'] }, preHandler: requireAuthHook }, async (req) => {
    const { id } = idParamSchema.parse(req.params);
    const user = requireAuth(req);
    const data = await svc.subscriptionFull(id);
    if (user.role === 'customer') {
      const mine = await db.select({ id: customers.id }).from(customers).where(eq(customers.userId, user.id)).limit(1);
      if (!mine[0] || data.customerId !== mine[0].id) {
        throw new AppError('forbidden', 'You can only view your own subscriptions.');
      }
    }
    return { subscription: data };
  });

  /* --------------------------------------------------------------- create */
  app.post('/', { schema: { tags: ['subscriptions'] }, preHandler: requireRole('admin', 'staff') }, async (req, reply) => {
    req.csrfValidate();
    const user = requireAuth(req);
    const data = parseOrThrow(createSchema, req.body);
    const id = await svc.createSubscription({ ...data, actorId: user.id });
    const full = await svc.subscriptionFull(id);
    return reply.status(201).send({ subscription: full });
  });

  /* ----------------------------------------------------------- transitions */
  app.post('/:id/transition', { schema: { tags: ['subscriptions'] }, preHandler: requireRole('admin', 'staff') }, async (req) => {
    req.csrfValidate();
    const { id } = idParamSchema.parse(req.params);
    const user = requireAuth(req);
    const { to, message } = parseOrThrow(transitionSchema, req.body ?? {});
    const result = await svc.transition(id, to, user.id, message);
    return result;
  });

  /* ------------------------------------------------------------------ lines */
  app.put(
    '/:id/lines',
    { schema: { tags: ['subscriptions'] }, preHandler: requireRole('admin', 'staff') },
    async (req) => {
      req.csrfValidate();
      const { id } = idParamSchema.parse(req.params);
      const lines = parseOrThrow(z.array(lineSchema).min(1, 'Add at least one line.'), req.body);
      await svc.replaceLines(id, lines);
      return { ok: true };
    },
  );

  app.get(
    '/:id/lines',
    { schema: { tags: ['subscriptions'] }, preHandler: requireAuthHook },
    async (req) => {
      const { id } = idParamSchema.parse(req.params);
      const rows = await db
        .select({ line: subscriptionLines, productName: products.name, taxRuleId: subscriptionLineTaxes.taxRuleId })
        .from(subscriptionLines)
        .innerJoin(products, eq(products.id, subscriptionLines.productId))
        .leftJoin(subscriptionLineTaxes, eq(subscriptionLineTaxes.lineId, subscriptionLines.id))
        .where(eq(subscriptionLines.subscriptionId, id));
      const map = new Map<number, z.infer<typeof lineSchema> & { id: number }>();
      for (const r of rows) {
        const key = r.line.id;
        if (!map.has(key)) {
          map.set(key, {
            id: key,
            productId: r.line.productId,
            variantId: r.line.variantId,
            planId: r.line.planId,
            productName: r.productName,
            quantity: r.line.quantity,
            unitPrice: r.line.unitPrice,
            taxRuleIds: [],
          } as never);
        }
        if (r.taxRuleId) {
          const entry = map.get(key)!;
          (entry as { taxRuleIds: number[] }).taxRuleIds.push(r.taxRuleId);
        }
      }
      return { items: [...map.values()] as never };
    },
  );

  /* -------------------------------------------------------------- discounts */
  app.get('/:id/discounts', { schema: { tags: ['subscriptions'] }, preHandler: requireAuthHook }, async (req) => {
    const { id } = idParamSchema.parse(req.params);
    const rows = await db
      .select({ rule: discountRules })
      .from(subscriptionDiscounts)
      .innerJoin(discountRules, eq(discountRules.id, subscriptionDiscounts.ruleId))
      .where(eq(subscriptionDiscounts.subscriptionId, id));
    return { items: rows.map((r) => r.rule) };
  });

  app.post(
    '/:id/discounts',
    { schema: { tags: ['subscriptions'] }, preHandler: requireRole('admin') },
    async (req) => {
      req.csrfValidate();
      const { id } = idParamSchema.parse(req.params);
      const { ruleId } = parseOrThrow(z.object({ ruleId: z.number().int().positive() }), req.body);
      const [rule] = await db.select({ id: discountRules.id, scope: discountRules.scope }).from(discountRules).where(eq(discountRules.id, ruleId)).limit(1);
      if (!rule) throw new AppError('not_found', 'Discount rule not found.');
      if (rule.scope === 'product') {
        throw new AppError('validation_error', 'Product-scope discounts attach automatically — only whole-subscription discounts can be pinned here.');
      }
      await db.insert(subscriptionDiscounts).values({ subscriptionId: id, ruleId }).onConflictDoNothing();
      return { ok: true };
    },
  );

  app.delete(
    '/:id/discounts/:ruleId',
    { schema: { tags: ['subscriptions'] }, preHandler: requireRole('admin') },
    async (req) => {
      req.csrfValidate();
      const params = parseOrThrow(z.object({ id: idParamSchema.shape.id, ruleId: idParamSchema.shape.id }), req.params);
      await db
        .delete(subscriptionDiscounts)
        .where(and(eq(subscriptionDiscounts.subscriptionId, params.id), eq(subscriptionDiscounts.ruleId, params.ruleId)));
      return { ok: true };
    },
  );

  /* --------------------------------------------------------------- bill now */
  app.post('/:id/bill', { schema: { tags: ['subscriptions'] }, preHandler: requireRole('admin', 'staff') }, async (req) => {
    req.csrfValidate();
    const { id } = idParamSchema.parse(req.params);
    const user = requireAuth(req);
    const res = await billNow(id, user.id);
    return res;
  });

  /* ------------------------------------------------------------ events feed */
  app.get('/:id/events', { schema: { tags: ['subscriptions'] }, preHandler: requireAuthHook }, async (req) => {
    const { id } = idParamSchema.parse(req.params);
    const items = await svc.listSubscriptionEvents(id);
    return { items };
  });

  /* ---------------------------------------------------------------- cancel etc */
  // convenience wrappers around /transition for the UI buttons
  for (const [action, to] of [
    ['send', 'quotation'],
    ['confirm', 'confirmed'],
    ['activate', 'active'],
    ['pause', 'paused'],
    ['resume', 'active'],
    ['cancel', 'cancelled'],
    ['close', 'closed'],
  ] as const) {
    app.post(
      `/:id/${action}`,
      { schema: { tags: ['subscriptions'] }, preHandler: requireRole('admin', 'staff') },
      async (req) => {
        req.csrfValidate();
        const { id } = idParamSchema.parse(req.params);
        const user = requireAuth(req);
        const result = await svc.transition(id, to as never, user.id);
        return result;
      },
    );
  }

  void sql;
  void users;
  void asc;
}

import type { FastifyInstance } from 'fastify';
import { and, eq, sql } from 'drizzle-orm';
import { z } from 'zod';

import { db } from '../db/client.js';
import { auditLog, discountRules, discountUsages, products } from '../db/schema.js';
import { requireAuth, requireRole } from '../plugins/auth.js';
import { AppError, idParamSchema, parseOrThrow } from '../lib/route-helpers.js';

const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD format.');

/**
 * Scene: "Only the admin can create discount rules" — fixed amount or percentage,
 * minimum purchase/quantity, start/end dates, usage limits, product or
 * subscription scope. The application happens automatically at invoice time.
 */
const discountSchema = z
  .object({
    code: z
      .string()
      .trim()
      .min(3, 'Code must be at least 3 characters.')
      .max(40)
      .regex(/^[A-Za-z0-9_-]+$/, 'Code can only contain letters, numbers, dashes and underscores.')
      .transform((v) => v.toUpperCase()),
    name: z.string().trim().min(2, 'Name is too short.').max(200),
    kind: z.enum(['fixed', 'percent']),
    // fixed: cents; percent: percent*100 (e.g. 1000 = 10%)
    value: z
      .number({ error: 'Value is required.' })
      .int('Value must be an integer (cents or percent*100).')
      .min(1, 'Value must be greater than zero.'),
    minPurchase: z.number().int().min(0).default(0),
    minQty: z.number().int().min(0).default(0),
    startsAt: dateStr.default(() => new Date().toISOString().slice(0, 10)),
    endsAt: dateStr.optional().nullable(),
    maxUses: z.number().int().min(1).optional().nullable(),
    scope: z.enum(['product', 'subscription']),
    productId: z.number().int().positive().optional().nullable(),
    isActive: z.boolean().default(true),
  })
  .refine((v) => v.kind !== 'percent' || v.value <= 9000, {
    message: 'Percentage discount cannot exceed 90%.',
    path: ['value'],
  })
  .refine((v) => v.scope !== 'product' || !!v.productId, {
    message: 'Product-scope discounts must choose a product.',
    path: ['productId'],
  })
  .refine((v) => !v.endsAt || v.endsAt > v.startsAt, {
    message: 'End date must be after the start date.',
    path: ['endsAt'],
  });

export default async function discountRoutes(app: FastifyInstance) {
  app.get('/', { schema: { tags: ['discounts'] }, preHandler: requireRole('admin', 'staff') }, async (req) => {
    const user = requireAuth(req);
    const rows = await db
      .select({
        rule: discountRules,
        productName: products.name,
      })
      .from(discountRules)
      .leftJoin(products, eq(products.id, discountRules.productId))
      .where(user.role === 'admin' ? undefined : sql`${discountRules.isActive}`)
      .orderBy(discountRules.code);    return { items: rows.map((r) => ({ ...r.rule, productName: r.productName })) };
  });

  app.post('/', { schema: { tags: ['discounts'] }, preHandler: requireRole('admin') }, async (req, reply) => {
    req.csrfValidate();
    const data = parseOrThrow(discountSchema, req.body);
    const dup = await db.select({ id: discountRules.id }).from(discountRules).where(eq(discountRules.code, data.code)).limit(1);
    if (dup.length > 0) throw new AppError('conflict', 'A discount rule with this code already exists.');
    const user = requireAuth(req);
    const [row] = await db.insert(discountRules).values({ ...data, createdBy: user.id }).returning();
    await db.insert(auditLog).values({
      actorId: user.id,
      action: 'discount.created',
      entity: 'discount_rule',
      entityId: row!.id,
      summary: `Created discount ${row!.code}`,
      after: row!,
    });
    return reply.status(201).send({ discount: row });
  });

  app.patch('/:id', { schema: { tags: ['discounts'] }, preHandler: requireRole('admin') }, async (req) => {
    req.csrfValidate();
    const { id } = idParamSchema.parse(req.params);
    // Modifications allowed after creation: dates, limits, activation
    const editable = discountSchema.partial().omit({ code: true, kind: true, scope: true });
    const patchData = parseOrThrow(editable, req.body);
    const [row] = await db.update(discountRules).set(patchData).where(eq(discountRules.id, id)).returning();
    if (!row) throw new AppError('not_found', 'Discount rule not found.');
    const user = requireAuth(req);
    await db.insert(auditLog).values({
      actorId: user.id,
      action: 'discount.updated',
      entity: 'discount_rule',
      entityId: id,
      summary: `Updated discount ${row.code}`,
    });
    return { discount: row };
  });

  app.post('/:id/deactivate', { schema: { tags: ['discounts'] }, preHandler: requireRole('admin') }, async (req) => {
    req.csrfValidate();
    const { id } = idParamSchema.parse(req.params);
    const [row] = await db.update(discountRules).set({ isActive: false }).where(eq(discountRules.id, id)).returning();
    if (!row) throw new AppError('not_found', 'Discount rule not found.');
    return { discount: row };
  });

  /* ---------------------------------------------------------------- usages */
  app.get('/:id/usages', { schema: { tags: ['discounts'] }, preHandler: requireRole('admin', 'staff') }, async (req) => {
    const { id } = idParamSchema.parse(req.params);
    const rows = await db.select().from(discountUsages).where(eq(discountUsages.ruleId, id));
    return { items: rows };
  });

  app.get('/validate', { schema: { tags: ['discounts'] }, preHandler: requireRole('admin', 'staff') }, async (req) => {
    // staff/admin preview: would this code apply to a given subscription id?
    const query = req.query as { code?: string; subscriptionId?: string };
    if (!query.code) throw new AppError('validation_error', 'Provide a discount code.');
    const [rule] = await db
      .select()
      .from(discountRules)
      .where(and(eq(discountRules.code, query.code.toUpperCase()), eq(discountRules.isActive, true)))
      .limit(1);
    if (!rule) return { applicable: false, reason: 'Invalid or inactive code.' };
    const today = new Date().toISOString().slice(0, 10);
    if (today < rule.startsAt) return { applicable: false, reason: 'This discount has not started yet.' };
    if (rule.endsAt && today > rule.endsAt) return { applicable: false, reason: 'This discount has expired.' };
    if (rule.maxUses !== null && rule.usedCount >= rule.maxUses) {
      return { applicable: false, reason: 'This discount has reached its usage limit.' };
    }
    return { applicable: true, discount: rule };
  });
}

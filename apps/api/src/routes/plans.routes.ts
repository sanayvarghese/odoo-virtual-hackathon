import type { FastifyInstance } from 'fastify';
import { and, eq, or } from 'drizzle-orm';
import { sql } from 'drizzle-orm';
import { z } from 'zod';

import { db } from '../db/client.js';
import { auditLog, plans, products } from '../db/schema.js';
import { requireAuth, requireRole, requireAuthHook } from '../plugins/auth.js';
import { AppError, idParamSchema, parseOrThrow } from '../lib/route-helpers.js';
import { cents } from '../lib/common-validators.js';

const planSchema = z
  .object({
    productId: z.coerce.number().int().positive(),
    variantId: z.coerce.number().int().positive().optional().nullable(),
    name: z.string().trim().min(2, 'Plan name is too short.').max(200),
    description: z.string().trim().max(1000).optional().nullable(),
    interval: z.enum(['daily', 'weekly', 'monthly', 'yearly']),
    price: cents('Plan price'),
    minQty: z.coerce.number().int().min(1, 'Minimum quantity must be at least 1.').default(1),
    validFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).default(() => new Date().toISOString().slice(0, 10)),
    validTo: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional()
      .nullable(),
    autoCloseAtEnd: z.boolean().default(true),
    allowPause: z.boolean().default(true),
    allowEarlyCancel: z.boolean().default(true),
    autoRenew: z.boolean().default(true),
    isActive: z.boolean().default(true),
  })
  .refine((v) => !v.validTo || v.validTo > v.validFrom, {
    message: 'Availability end date must be after the start date.',
    path: ['validTo'],
  });

export default async function planRoutes(app: FastifyInstance) {
  app.get('/', { schema: { tags: ['plans'] }, preHandler: requireAuthHook }, async (req) => {
    const conditions = [];
    const query = (req.query ?? {}) as Record<string, string | undefined>;
    if (query.productId) conditions.push(eq(plans.productId, Number(query.productId)));
    if (query.active === 'true') conditions.push(eq(plans.isActive, true));
    if (query.availableOnly === 'true') {
      conditions.push(
        and(
          sql`${plans.validFrom} <= CURRENT_DATE`,
          or(sql`${plans.validTo} IS NULL`, sql`${plans.validTo} >= CURRENT_DATE`),
          eq(plans.isActive, true),
        )!,
      );
    }
    const rows = await db
      .select({
        plan: plans,
        productName: products.name,
        productSku: products.sku,
      })
      .from(plans)
      .innerJoin(products, eq(products.id, plans.productId))
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(plans.name);
    return {
      items: rows.map((r) => ({ ...r.plan, productName: r.productName, productSku: r.productSku })),
    };
  });

  app.get('/:id', { schema: { tags: ['plans'] }, preHandler: requireAuthHook }, async (req) => {
    const { id } = idParamSchema.parse(req.params);
    const [row] = await db.select().from(plans).where(eq(plans.id, id)).limit(1);
    if (!row) throw new AppError('not_found', 'Plan not found.');
    return { plan: row };
  });

  app.post('/', { schema: { tags: ['plans'] }, preHandler: requireRole('admin') }, async (req, reply) => {
    req.csrfValidate();
    const data = parseOrThrow(planSchema, req.body);
    const [product] = await db.select({ id: products.id }).from(products).where(eq(products.id, data.productId)).limit(1);
    if (!product) throw new AppError('validation_error', 'Product does not exist.', {
      details: [{ path: 'productId', message: 'Select a valid product.' }],
    });
    const [row] = await db.insert(plans).values(data).returning();
    const user = requireAuth(req);
    await db.insert(auditLog).values({
      actorId: user.id,
      action: 'plan.created',
      entity: 'plan',
      entityId: row!.id,
      summary: `Created plan ${row!.name} (${row!.interval})`,
      after: row!,
    });
    return reply.status(201).send({ plan: row });
  });

  app.patch('/:id', { schema: { tags: ['plans'] }, preHandler: requireRole('admin') }, async (req) => {
    req.csrfValidate();
    const { id } = idParamSchema.parse(req.params);
    // replace full object semantics: partial update allowed
    const data = parseOrThrow(planSchema.partial(), req.body);
    const [before] = await db.select().from(plans).where(eq(plans.id, id)).limit(1);
    if (!before) throw new AppError('not_found', 'Plan not found.');
    const [row] = await db
      .update(plans)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(plans.id, id))
      .returning();
    const user = requireAuth(req);
    await db.insert(auditLog).values({
      actorId: user.id,
      action: 'plan.updated',
      entity: 'plan',
      entityId: id,
      summary: `Updated plan ${before.name}`,
      before,
      after: row!,
    });
    return { plan: row };
  });

  app.delete('/:id', { schema: { tags: ['plans'] }, preHandler: requireRole('admin') }, async (req) => {
    req.csrfValidate();
    const { id } = idParamSchema.parse(req.params);
    const [row] = await db.select().from(plans).where(eq(plans.id, id)).limit(1);
    if (!row) throw new AppError('not_found', 'Plan not found.');
    const { pool } = await import('../db/client.js');
    const { rows: usage } = await pool.query(
      "select count(*)::int as c from subscriptions where plan_id = $1 and status not in ('closed','cancelled')",
      [id],
    );
    if ((usage[0]?.c ?? 0) > 0) {
      throw new AppError('conflict', 'This plan has live subscriptions. Deactivate it instead of deleting.');
    }
    await db.delete(plans).where(eq(plans.id, id));
    await db.insert(auditLog).values({
      actorId: requireAuth(req).id,
      action: 'plan.deleted',
      entity: 'plan',
      entityId: id,
      summary: `Deleted plan ${row.name}`,
    });
    return { ok: true };
  });
}

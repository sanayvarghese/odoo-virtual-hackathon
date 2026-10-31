import type { FastifyInstance } from 'fastify';
import { and, asc, desc, eq, ilike, sql, count } from 'drizzle-orm';
import { z } from 'zod';

import { db } from '../db/client.js';
import { auditLog, products } from '../db/schema.js';
import { requireAuth, requireRole, requireAuthHook } from '../plugins/auth.js';
import { AppError, idParamSchema, pageSchema, parseOrThrow } from '../lib/route-helpers.js';
import { cents, sku } from '../lib/common-validators.js';

const createSchema = z.object({
  sku: sku,
  name: z.string().trim().min(2, 'Product name is too short.').max(200),
  kind: z.enum(['software', 'addon', 'service']).default('software'),
  salesPrice: cents('Sales price'),
  costPrice: cents('Cost price'),
  notes: z.string().trim().max(2000).optional(),
  isActive: z.boolean().default(true),
});

const updateSchema = createSchema.partial();

export default async function productRoutes(app: FastifyInstance) {
  /* ------------------------------------------------------------------ list */
  app.get('/', { schema: { tags: ['products'] }, preHandler: requireAuthHook }, async (req) => {
    const { q, page, limit, sort, dir } = pageSchema.parse(req.query ?? {});
    const conditions = [sql`1=1`];
    if (q) conditions.push(ilike(products.name, `%${q}%`));
    const where = and(...conditions);
    const sortCol = sort === 'sku' ? products.sku : sort === 'price' ? products.salesPrice : products.name;
    const [rows, totalRows] = await Promise.all([
      db
        .select()
        .from(products)
        .where(where)
        .orderBy(dir === 'asc' ? asc(sortCol) : desc(sortCol))
        .limit(limit)
        .offset((page - 1) * limit),
      db.select({ total: count() }).from(products).where(where),
    ]);
    return { items: rows, page, limit, total: totalRows[0]?.total ?? 0 };
  });

  /* ------------------------------------------------------------------- get */
  app.get('/:id', { schema: { tags: ['products'] }, preHandler: requireAuthHook }, async (req) => {
    const { id } = idParamSchema.parse(req.params);
    const [row] = await db.select().from(products).where(eq(products.id, id)).limit(1);
    if (!row) throw new AppError('not_found', 'Product not found.');
    return { product: row };
  });

  /* ---------------------------------------------------------------- create */
  app.post(
    '/',
    { schema: { tags: ['products'] }, preHandler: requireRole('admin') },
    async (req, reply) => {
      req.csrfValidate();
      const data = parseOrThrow(createSchema, req.body);
      const [row] = await db.insert(products).values(data).returning();
      const user = requireAuth(req);
      await db.insert(auditLog).values({
        actorId: user.id,
        action: 'product.created',
        entity: 'product',
        entityId: row!.id,
        summary: `Created product ${row!.name}`,
        after: row!,
      });
      return reply.status(201).send({ product: row });
    },
  );

  /* --------------------------------------------------------------- update */
  app.patch(
    '/:id',
    { schema: { tags: ['products'] }, preHandler: requireRole('admin') },
    async (req) => {
      req.csrfValidate();
      const { id } = idParamSchema.parse(req.params);
      const data = parseOrThrow(updateSchema, req.body);
      const [before] = await db.select().from(products).where(eq(products.id, id)).limit(1);
      if (!before) throw new AppError('not_found', 'Product not found.');
      const [row] = await db.update(products).set({ ...data, updatedAt: new Date() }).where(eq(products.id, id)).returning();
      const user = requireAuth(req);
      await db.insert(auditLog).values({
        actorId: user.id,
        action: 'product.updated',
        entity: 'product',
        entityId: id,
        summary: `Updated product ${before.name}`,
        before,
        after: row!,
      });
      return { product: row };
    },
  );

  /* ---------------------------------------------------------------- delete */
  app.delete(
    '/:id',
    { schema: { tags: ['products'] }, preHandler: requireRole('admin') },
    async (req, reply) => {
      req.csrfValidate();
      const { id } = idParamSchema.parse(req.params);
      // Soft-delete: billing history keeps referring to the product
      const [row] = await db
        .update(products)
        .set({ isActive: false, updatedAt: new Date() })
        .where(eq(products.id, id))
        .returning();
      if (!row) throw new AppError('not_found', 'Product not found.');
      const user = requireAuth(req);
      await db.insert(auditLog).values({
        actorId: user.id,
        action: 'product.deactivated',
        entity: 'product',
        entityId: id,
        summary: `Deactivated product ${row.name}`,
        after: row,
      });
      return reply.status(200).send({ ok: true });
    },
  );
}

/* ----------------------------------------------------------- shared zod utils (also used by sibling routes) */
export function ZodFailDetails(error: z.ZodError) {
  return error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
}

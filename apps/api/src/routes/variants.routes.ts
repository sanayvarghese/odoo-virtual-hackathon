import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { z } from 'zod';

import { db } from '../db/client.js';
import { auditLog, productVariants, products } from '../db/schema.js';
import { requireAuth, requireRole, requireAuthHook } from '../plugins/auth.js';
import { AppError, idParamSchema, parseOrThrow } from '../lib/route-helpers.js';
import { cents } from '../lib/common-validators.js';

const variantSchema = z.object({
  attribute: z.string().trim().min(1, 'Attribute (e.g. Brand) is required.').max(60),
  optionName: z.string().trim().min(1, 'Option (e.g. Odoo) is required.').max(120),
  priceDelta: cents('Price delta').default(0),
  skuSuffix: z.string().trim().max(32).optional(),
});

export default async function variantRoutes(app: FastifyInstance) {
  app.get(
    '/:id/variants',
    { schema: { tags: ['products'] }, preHandler: requireAuthHook },
    async (req) => {
      const { id } = idParamSchema.parse(req.params);
      const rows = await db.select().from(productVariants).where(eq(productVariants.productId, id));
      return { variants: rows };
    },
  );

  app.post(
    '/:id/variants',
    { schema: { tags: ['products'] }, preHandler: requireRole('admin') },
    async (req, reply) => {
      req.csrfValidate();
      const { id } = idParamSchema.parse(req.params);
      const data = parseOrThrow(variantSchema, req.body);
      const [product] = await db.select().from(products).where(eq(products.id, id)).limit(1);
      if (!product) throw new AppError('not_found', 'Product not found.');
      const [row] = await db
        .insert(productVariants)
        .values({ productId: id, ...data })
        .returning();
      const user = requireAuth(req);
      await db.insert(auditLog).values({
        actorId: user.id,
        action: 'variant.created',
        entity: 'product',
        entityId: id,
        summary: `Variant ${data.attribute}=${data.optionName} (+${(data.priceDelta / 100).toFixed(2)}) on ${product.name}`,
        after: row!,
      });
      return reply.status(201).send({ variant: row });
    },
  );

  app.delete(
    '/:id/variants/:variantId',
    { schema: { tags: ['products'] }, preHandler: requireRole('admin') },
    async (req) => {
      req.csrfValidate();
      const params = variantParams.parse(req.params);
      const [row] = await db
        .delete(productVariants)
        .where(eq(productVariants.id, params.variantId))
        .returning();
      if (!row) throw new AppError('not_found', 'Variant not found.');
      const user = requireAuth(req);
      await db.insert(auditLog).values({
        actorId: user.id,
        action: 'variant.deleted',
        entity: 'product',
        entityId: params.id,
        summary: `Removed variant ${row.attribute}=${row.optionName}`,
      });
      return { ok: true };
    },
  );
}

const variantParams = z.object({
  id: z.coerce.number().int().positive(),
  variantId: z.coerce.number().int().positive(),
});

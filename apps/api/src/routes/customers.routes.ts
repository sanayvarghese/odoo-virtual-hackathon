import type { FastifyInstance } from 'fastify';
import { eq, ilike, or, count } from 'drizzle-orm';
import { z } from 'zod';

import { db } from '../db/client.js';
import { customers, users } from '../db/schema.js';
import { requireAuth, requireRole, requireAuthHook } from '../plugins/auth.js';
import { AppError, idParamSchema, pageSchema, parseOrThrow } from '../lib/route-helpers.js';

const patchSchema = z
  .object({
    companyName: z.string().trim().min(2, 'Company name is too short.').max(200).optional(),
    contactName: z.string().trim().max(120).optional(),
    phone: z.string().trim().max(32).optional().nullable(),
    address: z.string().trim().max(500).optional().nullable(),
    taxId: z.string().trim().max(64).optional().nullable(),
    isActive: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'No changes provided.' });

export default async function customerRoutes(app: FastifyInstance) {
  /* staff/admin browse all customers */
  app.get('/', { schema: { tags: ['customers'] }, preHandler: requireRole('admin', 'staff') }, async (req) => {
    const { q, page, limit } = pageSchema.parse(req.query ?? {});
    const where = q
      ? or(
          ilike(customers.companyName, `%${q}%`),
          ilike(customers.contactName, `%${q}%`),
          ilike(users.email, `%${q}%`),
        )
      : undefined;
    const [rows, total] = await Promise.all([
      db
        .select({
          id: customers.id,
          companyName: customers.companyName,
          contactName: customers.contactName,
          email: users.email,
          phone: customers.phone,
          isActive: customers.isActive,
          createdAt: customers.createdAt,
        })
        .from(customers)
        .innerJoin(users, eq(users.id, customers.userId))
        .where(where)
        .orderBy(customers.companyName)
        .limit(limit)
        .offset((page - 1) * limit),
      db
        .select({ total: count() })
        .from(customers)
        .innerJoin(users, eq(users.id, customers.userId))
        .where(where),
    ]);
    return { items: rows, page, limit, total: total[0]?.total ?? 0 };
  });

  /* customer: own profile */
  app.get('/me', { schema: { tags: ['customers'] }, preHandler: requireAuthHook }, async (req) => {
    const user = requireAuth(req);
    const rows = await db.select().from(customers).where(eq(customers.userId, user.id)).limit(1);
    return { customer: rows[0] ?? null };
  });

  app.get('/:id', { schema: { tags: ['customers'] }, preHandler: requireAuthHook }, async (req) => {
    const { id } = idParamSchema.parse(req.params);
    const user = requireAuth(req);
    if (user.role === 'customer') {
      const own = await db.select({ id: customers.id }).from(customers).where(eq(customers.userId, user.id)).limit(1);
      if (!own[0] || own[0].id !== id) {
        throw new AppError('forbidden', 'Customers can only view their own record.');
      }
    }
    const [row] = await db
      .select({
        customer: customers,
        email: users.email,
        name: users.name,
      })
      .from(customers)
      .innerJoin(users, eq(users.id, customers.userId))
      .where(eq(customers.id, id))
      .limit(1);
    if (!row) throw new AppError('not_found', 'Customer not found.');
    return { ...row.customer, email: row.email, name: row.name };
  });

  app.patch('/:id', { schema: { tags: ['customers'] }, preHandler: requireAuthHook }, async (req) => {
    req.csrfValidate();
    const { id } = idParamSchema.parse(req.params);
    const user = requireAuth(req);
    const patch = parseOrThrow(patchSchema, req.body ?? {});

    if (user.role !== 'admin') {
      // staff & customers cannot toggle account activation
      const { isActive: _dropped, ...rest } = patch;
      void _dropped;

      if (user.role === 'customer') {
        const own = await db.select({ id: customers.id }).from(customers).where(eq(customers.userId, user.id)).limit(1);
        if (!own[0] || own[0].id !== id) {
          throw new AppError('forbidden', 'Customers can only update their own profile.');
        }
      }

      const [row] = await db
        .update(customers)
        .set({ ...rest, updatedAt: new Date() })
        .where(eq(customers.id, id))
        .returning();
      if (!row) throw new AppError('not_found', 'Customer not found.');
      return { customer: row };
    }

    const [row] = await db
      .update(customers)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(customers.id, id))
      .returning();
    if (!row) throw new AppError('not_found', 'Customer not found.');
    return { customer: row };
  });
}

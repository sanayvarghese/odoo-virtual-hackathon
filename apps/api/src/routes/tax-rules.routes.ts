import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { z } from 'zod';

import { db } from '../db/client.js';
import { auditLog, taxRules } from '../db/schema.js';
import { requireAuth, requireRole, requireAuthHook } from '../plugins/auth.js';
import { AppError, idParamSchema, parseOrThrow } from '../lib/route-helpers.js';

/** rate is percent*100 (1800 = 18%) to keep all math in integers */
const taxSchema = z.object({
  name: z.string().trim().min(2, 'Tax name is too short.').max(120),
  rate: z
    .number({ error: 'Rate is required.' })
    .int('Rate must be an integer percentage * 100 (e.g. 1800 = 18%).')
    .min(0, 'Rate cannot be negative.')
    .max(10000, 'Rate cannot exceed 100%.'),
  description: z.string().trim().max(500).optional().nullable(),
  isActive: z.boolean().default(true),
});

export default async function taxRuleRoutes(app: FastifyInstance) {
  app.get('/', { schema: { tags: ['taxes'] }, preHandler: requireAuthHook }, async () => {
    const rows = await db.select().from(taxRules).orderBy(taxRules.name);
    return { items: rows };
  });

  app.post('/', { schema: { tags: ['taxes'] }, preHandler: requireRole('admin') }, async (req, reply) => {
    req.csrfValidate();
    const data = parseOrThrow(taxSchema, req.body);
    const dup = await db.select({ id: taxRules.id }).from(taxRules).where(eq(taxRules.name, data.name)).limit(1);
    if (dup.length > 0) throw new AppError('conflict', 'A tax rule with this name already exists.');
    const [row] = await db.insert(taxRules).values(data).returning();
    const user = requireAuth(req);
    await db.insert(auditLog).values({
      actorId: user.id,
      action: 'tax.created',
      entity: 'tax_rule',
      entityId: row!.id,
      summary: `Created tax ${row!.name} (${row!.rate / 100}%)`,
    });
    return reply.status(201).send({ taxRule: row });
  });

  app.patch('/:id', { schema: { tags: ['taxes'] }, preHandler: requireRole('admin') }, async (req) => {
    req.csrfValidate();
    const { id } = idParamSchema.parse(req.params);
    const data = parseOrThrow(taxSchema.partial(), req.body);
    const [row] = await db
      .update(taxRules)
      .set(data)
      .where(eq(taxRules.id, id))
      .returning();
    if (!row) throw new AppError('not_found', 'Tax rule not found.');
    const user = requireAuth(req);
    await db.insert(auditLog).values({
      actorId: user.id,
      action: 'tax.updated',
      entity: 'tax_rule',
      entityId: id,
      summary: `Updated tax ${row.name}`,
    });
    return { taxRule: row };
  });

  app.delete('/:id', { schema: { tags: ['taxes'] }, preHandler: requireRole('admin') }, async (req) => {
    req.csrfValidate();
    const { id } = idParamSchema.parse(req.params);
    // soft delete: historical invoice lines reference tax rules
    const [row] = await db.update(taxRules).set({ isActive: false }).where(eq(taxRules.id, id)).returning();
    if (!row) throw new AppError('not_found', 'Tax rule not found.');
    return { ok: true };
  });
}

import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { z } from 'zod';

import { db } from '../db/client.js';
import { auditLog, products, quoteTemplateLines, quoteTemplates } from '../db/schema.js';
import { requireAuth, requireRole, requireAuthHook } from '../plugins/auth.js';
import { AppError, idParamSchema, parseOrThrow } from '../lib/route-helpers.js';
import { cents, sku } from '../lib/common-validators.js';
import { quantitySchema } from '../lib/validators.js';

/** Scene: "start from a quotation template that already has the right plan and
 *  product lines, and stays valid for a set number of days." */
const lineSchema = z.object({
  productId: z.number().int().positive(),
  variantId: z.number().int().positive().nullable().optional(),
  planId: z.number().int().positive().nullable().optional(),
  quantity: quantitySchema,
  unitPrice: cents('Unit price'),
});

export default async function quoteTemplateRoutes(app: FastifyInstance) {
  app.get('/', { schema: { tags: ['templates'] }, preHandler: requireAuthHook }, async () => {
    const rows = await db.select().from(quoteTemplates).orderBy(quoteTemplates.name);
    const withCounts = await Promise.all(
      rows.map(async (t) => {
        const lines = await db.select().from(quoteTemplateLines).where(eq(quoteTemplateLines.templateId, t.id));
        return { ...t, lineCount: lines.length };
      }),
    );
    return { items: withCounts };
  });

  app.get('/:id', { schema: { tags: ['templates'] }, preHandler: requireAuthHook }, async (req) => {
    const { id } = idParamSchema.parse(req.params);
    const [row] = await db.select().from(quoteTemplates).where(eq(quoteTemplates.id, id)).limit(1);
    if (!row) throw new AppError('not_found', 'Template not found.');
    const lines = await db
      .select({ line: quoteTemplateLines, productName: products.name })
      .from(quoteTemplateLines)
      .innerJoin(products, eq(products.id, quoteTemplateLines.productId))
      .where(eq(quoteTemplateLines.templateId, id));
    return { template: row, lines: lines.map((l) => ({ ...l.line, productName: l.productName })) };
  });

  app.post('/', { schema: { tags: ['templates'] }, preHandler: requireRole('admin', 'staff') }, async (req, reply) => {
    req.csrfValidate();
    const user = requireAuth(req);
    const data = parseOrThrow(
      z.object({
        name: z.string().trim().min(2, 'Template name is too short.').max(200),
        description: z.string().trim().max(1000).optional().nullable(),
        validDays: z.number().int().min(1, 'Validity must be at least 1 day.').max(365, 'Validity cannot exceed 365 days.'),
        lines: z.array(lineSchema).default([]),
      }),
      req.body,
    );
    const created = await db.transaction(async (tx) => {
      const [t] = await tx
        .insert(quoteTemplates)
        .values({ name: data.name, description: data.description ?? null, validDays: data.validDays })
        .returning();
      if (data.lines.length > 0) {
        await tx.insert(quoteTemplateLines).values(data.lines.map((l) => ({ ...l, templateId: t!.id })));
      }
      return t!;
    });
    await db.insert(auditLog).values({
      actorId: user.id,
      action: 'quote_template.created',
      entity: 'quote_template',
      entityId: created.id,
      summary: `Created quotation template ${created.name}`,
    });
    return reply.status(201).send({ template: created });
  });

  app.delete('/:id', { schema: { tags: ['templates'] }, preHandler: requireRole('admin') }, async (req) => {
    req.csrfValidate();
    const { id } = idParamSchema.parse(req.params);
    const [row] = await db.select().from(quoteTemplates).where(eq(quoteTemplates.id, id)).limit(1);
    if (!row) throw new AppError('not_found', 'Template not found.');
    // Block delete when subscriptions reference the template
    const { pool } = await import('../db/client.js');
    const { rows: usage } = await pool.query(
      'select count(*)::int as c from subscriptions where template_id = $1',
      [id],
    );
    if ((usage[0]?.c ?? 0) > 0) {
      throw new AppError('conflict', 'This template is used by subscriptions and cannot be deleted.');
    }
    await db.delete(quoteTemplates).where(eq(quoteTemplates.id, id));
    await db.insert(auditLog).values({
      actorId: requireAuth(req).id,
      action: 'quote_template.deleted',
      entity: 'quote_template',
      entityId: id,
      summary: `Deleted template ${row.name}`,
    });
    return { ok: true };
  });
}

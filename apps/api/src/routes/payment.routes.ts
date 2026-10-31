import type { FastifyInstance } from 'fastify';
import { desc, eq, sql, count, and } from 'drizzle-orm';
import { z } from 'zod';

import { db } from '../db/client.js';
import { customers, invoices, payments } from '../db/schema.js';
import { requireAuth, requireRole, requireAuthHook } from '../plugins/auth.js';
import { AppError, idParamSchema, pageSchema, parseOrThrow } from '../lib/route-helpers.js';
import { isoDate } from '../lib/validators.js';

/** Scene: "Payments arrive by different methods and on different days." */
const paymentSchema = z
  .object({
    invoiceId: z.number().int().positive(),
    method: z.enum(['cash', 'card', 'bank_transfer', 'upi', 'cheque']),
    amount: z
      .number({ error: 'Amount is required.' })
      .int('Amount must be an integer amount of cents.')
      .min(1, 'Payment amount must be greater than zero.'),
    paidAt: isoDate.default(() => new Date().toISOString().slice(0, 10)),
    reference: z.string().trim().max(80).optional(),
    note: z.string().trim().max(500).optional(),
  })
  .refine(() => true);

export default async function paymentRoutes(app: FastifyInstance) {
  /* ------------------------------------------------------------------ list */
  app.get('/', { schema: { tags: ['payments'] }, preHandler: requireAuthHook }, async (req) => {
    const user = requireAuth(req);
    const { q, page, limit } = pageSchema.parse(req.query ?? {});
    const query = (req.query ?? {}) as Record<string, string | undefined>;
    const conditions = [];
    if (query.invoiceId) conditions.push(eq(payments.invoiceId, Number(query.invoiceId)));
    if (query.customerId) conditions.push(eq(payments.customerId, Number(query.customerId)));
    if (user.role === 'customer') {
      const mine = await db.select({ id: customers.id }).from(customers).where(eq(customers.userId, user.id)).limit(1);
      if (!mine[0]) return { items: [], page, limit, total: 0 };
      conditions.push(eq(payments.customerId, mine[0].id));
    }
    const where = conditions.length > 0 ? and(...conditions) : undefined;
    const [rows, totalRows] = await Promise.all([
      db
        .select({
          payment: payments,
          invoiceNumber: invoices.number,
          invoiceTotal: invoices.total,
          customerName: customers.companyName,
        })
        .from(payments)
        .innerJoin(invoices, eq(invoices.id, payments.invoiceId))
        .innerJoin(customers, eq(customers.id, payments.customerId))
        .where(where)
        .orderBy(desc(payments.paidAt), desc(payments.id))
        .limit(limit)
        .offset((page - 1) * limit),
      db.select({ total: count() }).from(payments).where(where),
    ]);
    return {
      items: rows.map((r) => ({ ...r.payment, invoiceNumber: r.invoiceNumber, invoiceTotal: r.invoiceTotal, customerName: r.customerName })),
      page,
      limit,
      total: totalRows[0]?.total ?? 0,
    };
  });

  /* --------------------------------------------------------- record payment */
  app.post('/', { schema: { tags: ['payments'] }, preHandler: requireAuthHook }, async (req, reply) => {
    req.csrfValidate();
    const user = requireAuth(req);
    const data = parseOrThrow(paymentSchema, req.body ?? {});

    const [invoice] = await db.select().from(invoices).where(eq(invoices.id, data.invoiceId)).limit(1);
    if (!invoice) throw new AppError('not_found', 'Invoice not found.');

    const [customer] = await db.select().from(customers).where(eq(customers.userId, user.id)).limit(1);

    if (user.role === 'customer') {
      if (!customer || customer.id !== invoice.customerId) {
        throw new AppError('forbidden', 'You can only pay your own invoices.');
      }
      if (invoice.status === 'paid') {
        throw new AppError('conflict', 'This invoice is already fully paid.');
      }
    } else {
      const balance = invoice.total - invoice.paidTotal;
      if (invoice.status === 'paid') throw new AppError('conflict', 'This invoice is already fully paid.');
      if (invoice.status === 'cancelled') throw new AppError('conflict', 'A cancelled invoice cannot receive payments.');
      if (data.amount > balance) {
        throw new AppError(
          'business_rule',
          `Payment exceeds the outstanding balance (due: ${(balance / 100).toFixed(2)}).`,
        );
      }
    }

    const created = await db.transaction(async (tx) => {
      const [payment] = await tx
        .insert(payments)
        .values({
          invoiceId: invoice.id,
          customerId: invoice.customerId,
          method: data.method,
          amount: data.amount,
          paidAt: data.paidAt,
          reference: data.reference ?? null,
          note: data.note ?? null,
        })
        .returning();

      const newPaid = invoice.paidTotal + data.amount;
      await tx
        .update(invoices)
        .set({
          paidTotal: newPaid,
          status: newPaid >= invoice.total ? 'paid' : invoice.status === 'cancelled' ? 'confirmed' : invoice.status,
          updatedAt: new Date(),
        })
        .where(eq(invoices.id, invoice.id));
      return payment!;
    });

    return reply.status(201).send({
      payment: created,
      invoiceStatus: invoice.paidTotal + data.amount >= invoice.total ? 'paid' : 'confirmed',
    });
  });

  /* -------------------------------------------------------------- overdue */
  app.get('/overdue', { schema: { tags: ['payments'] }, preHandler: requireRole('admin', 'staff') }, async () => {
    const { pool } = await import('../db/client.js');
    const { rows } = await pool.query(
      // uses v_outstanding from views.sql
      'SELECT * FROM v_outstanding WHERE is_overdue ORDER BY days_overdue DESC LIMIT 500',
    );
    return { items: rows };
  });
}

import type { FastifyInstance } from 'fastify';
import { and, eq, sql } from 'drizzle-orm';

import { db } from '../db/client.js';
import { customers } from '../db/schema.js';
import { requireAuth, requireRole, requireAuthHook } from '../plugins/auth.js';

/**
 * Finance-lead dashboard (Scene: "one place to see active subscriptions,
 * revenue, payments and overdue invoices, with filters and a summary view").
 * Backed by SQL views (v_mrr, v_outstanding, v_revenue_monthly) so every kpi
 * is one indexed query — pages stay well under 2s even with thousands of rows.
 */
export default async function reportRoutes(app: FastifyInstance) {
  app.get('/summary', { schema: { tags: ['reports'] }, preHandler: requireAuthHook }, async (req) => {
    const user = requireAuth(req);
    const { pool } = await import('../db/client.js');

    // customer role: only their own slice
    let customerId: number | null = null;
    if (user.role === 'customer') {
      const mine = await db.select({ id: customers.id }).from(customers).where(eq(customers.userId, user.id)).limit(1);
      customerId = mine[0]?.id ?? -1;
    }

    const scope = customerId ? sql`WHERE customer_id = ${customerId}` : sql``;

    const [kpis, mrr, revenue, outstanding] = await Promise.all([
      pool.query(
        `SELECT
          (SELECT count(*) FROM subscriptions s ${customerId ? 'JOIN customers c ON c.id=s.customer_id WHERE c.id = $1 AND s.status IN (\'active\',\'paused\')' : "WHERE s.status IN ('active','paused')"}) AS active_subscriptions,
          (SELECT count(*) FROM subscriptions s ${customerId ? 'JOIN customers c ON c.id=s.customer_id WHERE c.id = $1 AND s.status = \'draft\'' : "WHERE s.status = 'draft'"}) AS draft_subscriptions,
          (SELECT coalesce(sum(p.amount),0) FROM payments p ${customerId ? 'JOIN customers c ON c.id=p.customer_id WHERE c.id = $1' : ''}) AS revenue_paid_cents,
          (SELECT count(*) FROM invoices i ${customerId ? 'JOIN customers c ON c.id=i.customer_id WHERE c.id = $1 AND' : 'WHERE'} i.status = 'confirmed' AND i.due_date < CURRENT_DATE) AS overdue_invoices,
          (SELECT coalesce(sum(total - paid_total),0) FROM invoices i ${customerId ? 'JOIN customers c ON c.id=i.customer_id WHERE c.id = $1 AND' : 'WHERE'} i.status = 'confirmed') AS outstanding_cents,
          (SELECT count(*) FROM customers) AS customers,
          (SELECT count(*) FROM invoices i ${customerId ? 'JOIN customers c ON c.id=i.customer_id WHERE c.id = $1 AND' : 'WHERE'} i.status = 'confirmed') AS open_invoices`,
        customerId ? [customerId] : [],
      ),
      pool.query(
        `SELECT coalesce(SUM(mrr_cents),0)::bigint AS mrr_cents FROM v_mrr ${customerId ? 'WHERE customer_id = $1' : ''}`,
        customerId ? [customerId] : [],
      ),
      pool.query(
        `SELECT month, SUM(revenue_cents)::bigint AS amount FROM v_revenue_monthly GROUP BY month ORDER BY month DESC LIMIT 12`,
      ),
      pool.query(
        `SELECT * FROM v_outstanding ${customerId ? 'WHERE customer_id = $1' : ''} ORDER BY due_date ASC LIMIT 10`,
        customerId ? [customerId] : [],
      ),
    ]);

    const k = kpis.rows[0] ?? {};
    return {
      activeSubscriptions: Number(k.active_subscriptions ?? 0),
      draftSubscriptions: Number(k.draft_subscriptions ?? 0),
      revenuePaidCents: Number(k.revenue_paid_cents ?? 0),
      overdueInvoices: Number(k.overdue_invoices ?? 0),
      outstandingCents: Number(k.outstanding_cents ?? 0),
      customers: Number(k.customers ?? 0),
      openInvoices: Number(k.open_invoices ?? 0),
      mrrCents: Number(mrr.rows[0]?.mrr_cents ?? 0),
      revenueSeries: (revenue.rows ?? []).map((r) => ({ month: r.month, amount: Number(r.amount) })).reverse(),
      outstandingList: outstanding.rows ?? [],
    };
  });

  /* ------------------------------------------------- series for the charts */
  app.get('/series', { schema: { tags: ['reports'] }, preHandler: requireRole('admin', 'staff') }, async (req) => {
    const { pool } = await import('../db/client.js');
    const query = (req.query ?? {}) as Record<string, string | undefined>;
    const metric = query.metric ?? 'revenue';
    if (metric === 'mrr') {
      const { rows } = await pool.query(
        `SELECT interval, count(*)::int AS subs, SUM(mrr_cents)::bigint AS mrr_cents FROM v_mrr GROUP BY interval ORDER BY 4 DESC`,
      );
      return { items: rows };
    }
    if (metric === 'subscriptions') {
      const { rows } = await pool.query(
        `SELECT status, count(*)::int AS count_t FROM subscriptions GROUP BY status ORDER BY 2 DESC`,
      );
      return { items: rows };
    }
    const { rows } = await pool.query(
      `SELECT month, SUM(revenue_cents)::bigint AS amount, count(*)::int AS payments FROM v_revenue_monthly GROUP BY month ORDER BY month DESC LIMIT 24`,
    );
    return { items: rows.reverse() };
  });
}

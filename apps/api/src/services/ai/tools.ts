/**
 * Copilot tool registry. THE SECURITY BOUNDARY:
 * every tool declares allowed roles and executes through the same DB scoping
 * rules as the REST API — the LLM can never see or query more than the session
 * user is entitled to. Tools are read-only unless explicitly marked otherwise.
 */
import type { AuthedUser } from '../../plugins/auth.js';
import { pool } from '../../db/client.js';
import type { OllamaTool } from '../../lib/ollama.js';

export interface ToolResult {
  ok: boolean;
  data?: unknown;
  error?: string;
}

export interface ToolDef {
  name: string;
  description: string;
  roles: Array<'admin' | 'staff' | 'customer'>; // [] = any
  parameters: Record<string, unknown>; // JSON schema
  write?: boolean;
  handler: (user: AuthedUser, args: Record<string, unknown>) => Promise<ToolResult>;
}

const n = (v: unknown, fallback = 20) => Math.max(1, Math.min(50, Number(v) || fallback));

/* ------------------------------------------------------------------ helpers */

async function getCustomerId(user: AuthedUser): Promise<number | null> {
  if (user.role !== 'customer') return null;
  const { rows } = await pool.query<{ id: number }>('SELECT id FROM customers WHERE user_id = $1 LIMIT 1', [user.id]);
  return rows[0]?.id ?? -1;
}

/* -------------------------------------------------------------- the tools */

export const TOOLS: ToolDef[] = [
  {
    name: 'get_kpis',
    description:
      'Live business KPIs: active subscriptions count, MRR, revenue collected, outstanding balance, overdue invoice count and open invoice count. Customer role gets their own numbers only.',
    roles: [], // all roles; scoping happens by role inside
    parameters: { type: 'object', properties: {}, required: [] },
    async handler(user) {
      const isCustomer = user.role === 'customer';
      const params: unknown[] = isCustomer ? [user.id] : [];
      const { rows } = await pool.query(
        `SELECT
           (SELECT count(*) FROM subscriptions s
              JOIN customers c ON c.id = s.customer_id
              WHERE ${isCustomer ? 'c.user_id = $1' : 'TRUE'} AND s.status IN ('active','paused')) AS active_subs,
           (SELECT COALESCE(SUM(m.mrr_cents),0) FROM v_mrr m
              WHERE ${isCustomer ? 'm.customer_id = (SELECT id FROM customers WHERE user_id = $1)' : 'TRUE'}) AS mrr_cents,
           (SELECT COALESCE(SUM(p.amount),0) FROM payments p
              JOIN customers c ON c.id = p.customer_id
              WHERE ${isCustomer ? 'c.user_id = $1' : 'TRUE'}) AS revenue_cents,
           (SELECT count(*) FROM invoices i
              JOIN customers c ON c.id = i.customer_id
              WHERE ${isCustomer ? 'c.user_id = $1 AND ' : ''} i.status = 'confirmed' AND i.due_date < CURRENT_DATE) AS overdue_invoices,
           (SELECT COALESCE(SUM(i.total - i.paid_total),0) FROM invoices i
              JOIN customers c ON c.id = i.customer_id
              WHERE ${isCustomer ? 'c.user_id = $1 AND ' : ''} i.status = 'confirmed') AS outstanding_cents`,
        params,
      );
      return { ok: true, data: rows[0] };
    },
  },
  {
    name: 'list_subscriptions',
    description: 'List subscriptions with number, customer, plan, status, quantity, amounts, next billing date. Filter by status. Customer sees own only.',
    roles: [],
    parameters: {
      type: 'object',
      properties: {
        status: { type: 'string', description: 'draft|quotation|confirmed|active|paused|closed|cancelled' },
        limit: { type: 'integer' },
      },
      required: [],
    },
    async handler(user, args) {
      const cid = await getCustomerId(user);
      const status = typeof args.status === 'string' ? args.status : null;
      const { rows } = await pool.query(
        `SELECT s.number, c.company_name AS customer, p.name AS plan, p.interval,
                s.status, s.quantity, s.start_date, s.expiry_date, s.next_billing_date
         FROM subscriptions s
         JOIN customers c ON c.id = s.customer_id
         JOIN plans p ON p.id = s.plan_id
         WHERE ($1::text IS NULL OR s.status = $1)
           ${user.role === 'customer' ? 'AND s.customer_id = $2' : ''}
         ORDER BY s.created_at DESC LIMIT $3`,
        user.role === 'customer' ? [status, cid, n(args.limit)] : [status, n(args.limit)],
      );
      return { ok: true, data: rows };
    },
  },
  {
    name: 'list_overdue_invoices',
    description: 'Confirmed invoices that are past due and not fully paid, with days overdue. Staff/admin only.',
    roles: ['admin', 'staff'],
    parameters: { type: 'object', properties: { limit: { type: 'integer' } }, required: [] },
    async handler(_user, args) {
      const { rows } = await pool.query(
        'SELECT number, company_name, balance_due, due_date, days_overdue FROM v_outstanding WHERE is_overdue ORDER BY days_overdue DESC LIMIT $1',
        [n(args.limit)],
      );
      return { ok: true, data: rows };
    },
  },
  {
    name: 'revenue_by_month',
    description: 'Cash collected per month (last N months), staff/admin only.',
    roles: ['admin', 'staff'],
    parameters: { type: 'object', properties: { months: { type: 'integer' } }, required: [] },
    async handler(_user, args) {
      const { rows } = await pool.query(
        'SELECT month, revenue_cents, payment_count FROM v_revenue_monthly ORDER BY month DESC LIMIT $1',
        [n(args.months, 12)],
      );
      return { ok: true, data: rows };
    },
  },
  {
    name: 'find_customer',
    description: 'Find customers by name (company or contact), with counts of their subscriptions. Staff/admin only.',
    roles: ['admin', 'staff'],
    parameters: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] },
    async handler(_user, args) {
      const name = String(args.name ?? '');
      const { rows } = await pool.query(
        `SELECT c.company_name, c.contact_name, u.email,
                (SELECT count(*) FROM subscriptions s WHERE s.customer_id = c.id AND s.status='active') AS active_subs
         FROM customers c JOIN users u ON u.id = c.user_id
         WHERE c.company_name ILIKE $1 OR c.contact_name ILIKE $1 LIMIT 10`,
        [`%${name}%`],
      );
      return { ok: true, data: rows };
    },
  },
  {
    name: 'list_my_invoices',
    description:
      'List invoices: customers get their own; staff/admin may pass a customer name. Shows status, total, paid, due date.',
    roles: [],
    parameters: {
      type: 'object',
      properties: { customerName: { type: 'string'}, status: { type: 'string' }, limit: { type: 'integer' } },
      required: [],
    },
    async handler(user, args) {
      const params: unknown[] = [];
      let where = 'TRUE';
      if (user.role === 'customer') {
        const cid = await getCustomerId(user);
        params.push(cid);
        where = 'c.user_id = $1';
      } else if (typeof args.customerName === 'string' && args.customerName.trim()) {
        params.push(`%${args.customerName.trim()}%`);
        where = `c.company_name ILIKE $${params.length}`;
      }
      if (typeof args.status === 'string' && args.status) {
        params.push(String(args.status));
        where += ` AND i.status = $${params.length}`;
      }
      params.push(n(args.limit));
      where += ` LIMIT $${params.length}`;
      const { rows } = await pool.query(
        `SELECT i.number, c.company_name AS customer, i.status, i.total, i.paid_total, i.due_date,
                (i.total > i.paid_total AND i.due_date < CURRENT_DATE) AS is_overdue
         FROM invoices i JOIN customers c ON c.id = i.customer_id WHERE ${where} ORDER BY i.issue_date DESC`,
        params,
      );
      return { ok: true, data: rows };
    },
  },
  {
    name: 'list_plans',
    description: 'Product plans currently for sale: interval, price, min quantity, pause/renew flags. Filter by product name.',
    roles: [],
    parameters: {
      type: 'object',
      properties: { productName: { type: 'string' }, limit: { type: 'integer' } },
      required: [],
    },
    async handler(_user, args) {
      const params: unknown[] = [];
      let where = 'p.is_active AND p.valid_from <= CURRENT_DATE AND (p.valid_to IS NULL OR p.valid_to >= CURRENT_DATE)';
      if (typeof args.productName === 'string' && args.productName.trim()) {
        params.push(`%${args.productName.trim()}%`);
        where += ` AND pr.name ILIKE $${params.length}`;
      }
      params.push(n(args.limit, 15));
      const { rows } = await pool.query(
        `SELECT pr.name AS product, p.name, p.interval, p.price, p.min_qty,
                p.allow_pause, p.auto_renew, p.valid_from, p.valid_to
         FROM plans p JOIN products pr ON pr.id = p.product_id WHERE ${where} ORDER BY p.price LIMIT $${params.length}`,
        params,
      );
      return { ok: true, data: rows };
    },
  },
  {
    name: 'recommend_plan',
    description:
      'Deterministic recommendation: given needed seats and a budget (per month, in rupees), finds the cheapest active plan satisfying min quantity. Explains the math.',
    roles: [],
    parameters: {
      type: 'object',
      properties: { seats: { type: 'integer' }, budgetPerMonthRupees: { type: 'integer' } },
      required: [],
    },
    async handler(_user, args) {
      const seats = Math.max(1, Number(args.seats ?? 1));
      const budget = Number(args.budgetPerMonthRupees ?? Number.MAX_SAFE_INTEGER);
      const { rows } = await pool.query(
        `SELECT pr.name AS product, p.name, p.interval, p.price, p.min_qty
         FROM plans p JOIN products pr ON pr.id = p.product_id
         WHERE p.is_active AND p.min_qty <= $1 AND p.valid_from <= CURRENT_DATE
           AND (p.valid_to IS NULL OR p.valid_to >= CURRENT_DATE)
         ORDER BY p.price ASC`,
        [seats],
      );
      const monthly = (interval: string, price: number) =>
        interval === 'yearly' ? price / 12 : interval === 'daily' ? price * 30 : interval === 'weekly' ? (price * 13) / 3 : price;
      const fits = rows
        .map((r) => ({ ...r, monthly_rupees: monthly(String(r.interval), Number(r.price)) / 100 }))
        .filter((r) => r.monthly_rupees <= budget)
        .slice(0, 3);
      return { ok: true, data: { seats, budgetPerMonthRupees: budget, options: fits, checked: rows.length } };
    },
  },
  {
    name: 'draft_quote',
    description:
      'Staff tool (writes): draft a subscription for a customer from a plan — a quotation the team can confirm. Give the customer company name (or part of it), the plan name (or part), and seats.',
    roles: ['admin', 'staff'],
    parameters: {
      type: 'object',
      properties: {
        company: { type: 'string' },
        planName: { type: 'string' },
        quantity: { type: 'integer' },
      },
      required: ['company', 'planName'],
    },
    write: true,
    async handler(user, args) {
      const company = String(args.company ?? '').trim();
      const planName = String(args.planName ?? '').trim();
      if (!company || !planName) return { ok: false, error: 'company and planName are required.' };
      const c = await pool.query<{ id: number; company_name: string }>(
        'SELECT id, company_name FROM customers WHERE company_name ILIKE $1 ORDER BY id LIMIT 1',
        [`%${company}%`],
      );
      if (!c.rows[0]) return { ok: false, error: `No customer matches "${company}".` };
      const p = await pool.query<{ id: number; name: string; min_qty: number }>(
        'SELECT id, name, min_qty FROM plans WHERE name ILIKE $1 AND is_active ORDER BY id LIMIT 1',
        [`%${planName}%`],
      );
      if (!p.rows[0]) return { ok: false, error: `No active plan matches "${planName}".` };
      const qty = Math.max(p.rows[0].min_qty, Math.max(1, Number(args.quantity) || 1));
      const svc = await import('../../services/subscription.service.js');
      const id = await svc.createSubscription({
        customerId: c.rows[0].id,
        planId: p.rows[0].id,
        quantity: qty,
        startDate: new Date().toISOString().slice(0, 10),
        actorId: user.id,
        notes: `Quotation drafted by the copilot (${user.email})`,
      });
      const full = await svc.subscriptionFull(id);
      return {
        ok: true,
        data: {
          number: full.number,
          status: full.status,
          customer: full.customer?.companyName ?? c.rows[0].company_name,
          plan: full.plan?.name ?? p.rows[0].name,
          quantity: full.quantity,
          message: 'Draft created. Find it under Subscriptions to send and confirm.',
        },
      };
    },
  },
  {
    name: 'go_to_page',
    description:
      'Client-side action: send the user to a Brightloop screen. Use when the user asks to open/show/take them somewhere. Page ids: dashboard, subscriptions, invoices, payments, products, plans, customers, staff, taxes, reports, settings, mailbox, portal (their own portal).',
    roles: [],
    parameters: {
      type: 'object',
      properties: { page: { type: 'string' } },
      required: ['page'],
    },
    // No handler execution happens here — runTool treats CLIENT_TOOLS specially.
    async handler() {
      return { ok: true, data: { client: true } };
    },
  },
];

/** Only expose tools the session user's role may use */
export function toolsForRole(role: 'admin' | 'staff' | 'customer'): OllamaTool[] {
  return TOOLS.filter((t) => t.roles.length === 0 || t.roles.includes(role)).map((t) => ({
    type: 'function',
    function: { name: t.name, description: t.description, parameters: t.parameters },
  }));
}

export async function runTool(
  user: AuthedUser,
  name: string,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const tool = TOOLS.find((t) => t.name === name);
  if (!tool) return { ok: false, error: `Unknown tool '${name}'` };
  if (tool.roles.length > 0 && !tool.roles.includes(user.role)) {
    return { ok: false, error: `Tool '${name}' is not available for role '${user.role}'` };
  }
  try {
    return await tool.handler(user, args);
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

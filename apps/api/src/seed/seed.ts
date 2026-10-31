/**
 * Brightloop demo seed — deterministic demo data + REAL billing run.
 *
 * Run:  npm run seed            (adds what's missing, keeps existing)
 *       npm run seed:fresh      (wipes + seeds)
 */
import { config } from 'dotenv';
config();

if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = 'postgres://postgres:root@localhost:5432/brightloop';
}

import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { eq, inArray } from 'drizzle-orm';
import { hash as argonHash } from '@node-rs/argon2';

import { env } from '../env.js';
import {
  customers,
  discountRules,
  invoices,
  plans,
  products,
  productVariants,
  quoteTemplateLines,
  quoteTemplates,
  subscriptionDiscounts,
  subscriptionEvents,
  subscriptionLineTaxes,
  subscriptionLines,
  subscriptions,
  taxRules,
  users,
} from '../db/schema.js';
import { nextNumber } from '../services/numbering.service.js';

const pool = new pg.Pool({ connectionString: env.DATABASE_URL });
const db = drizzle(pool);

const FRESH = process.argv.includes('--fresh');

if (FRESH) {
  console.log('• fresh: truncating all tables…');
  await pool.query(`
    TRUNCATE payments, invoice_line_taxes, invoice_lines, invoice_discounts, invoices,
             subscription_line_taxes, subscription_lines, subscription_discounts,
             subscription_events, subscriptions, quote_template_lines, quote_templates,
             discount_usages, discount_rules, tax_rules, plans, product_variants, products,
             customers, email_tokens, sessions, users, numberings, audit_log, ai_import_jobs
    RESTART IDENTITY CASCADE;
  `);
}

const ARGON = { memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;
const passwordHash = await argonHash(env.SEED_PASSWORD, ARGON);

const today = () => new Date().toISOString().slice(0, 10);
const shiftDays = (days: number, base = new Date()) => {
  const d = new Date(base);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};
const INTERVAL_DAYS = { daily: 1, weekly: 7, monthly: 30, yearly: 365 } as const;
type IntervalKey = keyof typeof INTERVAL_DAYS;

async function upsertUser(email: string, name: string, role: 'admin' | 'staff' | 'customer') {
  const [existing] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (existing) return existing;
  const [u] = await db
    .insert(users)
    .values({ email, name, role, passwordHash, emailVerified: true })
    .returning();
  return u!;
}

/* ------------------------------------------------------------------ users */
const admin = await upsertUser('admin@brightloop.dev', 'Priya Menon (Admin)', 'admin');
await upsertUser('staff@brightloop.dev', 'Marcus Reed (Staff)', 'staff');

const customerDefs = [
  { email: 'customer@brightloop.dev', company: 'Sunrise Retail', contact: 'Anita Sharma', city: 'Kochi' },
  { email: 'customer2@brightloop.dev', company: 'Acme Traders', contact: 'John Korchill', city: 'Mumbai' },
  { email: 'deepa@nirvanalabs.dev', company: 'Nirvana Labs', contact: 'Deepa Iyer', city: 'Bengaluru' },
  { email: 'hello@bluetide.co', company: 'Bluetide Design', contact: 'Ravi Menon', city: 'Panaji' },
  { email: 'ops@marblehills.in', company: 'Marble Hills Resorts', contact: 'Sara Fernandes', city: 'Mysuru' },
];

const customerRecords = [];
for (const c of customerDefs) {
  const u = await upsertUser(c.email, c.contact, 'customer');
  const [existing] = await db.select().from(customers).where(eq(customers.userId, u.id)).limit(1);
  if (existing) {
    customerRecords.push(existing);
    continue;
  }
  const [cust] = await db
    .insert(customers)
    .values({
      userId: u.id,
      companyName: c.company,
      contactName: c.contact,
      phone: '+91 9800000000',
      address: c.city,
    })
    .returning();
  customerRecords.push(cust!);
}

/* -------------------------------------------------------------- catalogue */
const productSeed = [
  { sku: 'BL-SUITE', name: 'Brightloop Suite', kind: 'software', salesPrice: 2499000, costPrice: 400000, notes: 'Full business suite: CRM, billing, inventory.' },
  { sku: 'BL-CRM', name: 'Brightloop CRM', kind: 'software', salesPrice: 999000, costPrice: 100000, notes: 'Customer relationship management.' },
  { sku: 'BL-ADD-SSH', name: 'Extra Seat Pack', kind: 'addon', salesPrice: 199000, costPrice: 20000, notes: 'Per-seat add-on, up to 25 seats.' },
  { sku: 'BL-ADD-INT', name: 'Advanced Integrations', kind: 'addon', salesPrice: 149000, costPrice: 15000, notes: 'Webhooks, Zapier, custom connectors.' },
  { sku: 'BL-SRV-ONB', name: 'Onboarding Service', kind: 'service', salesPrice: 499000, costPrice: 350000, notes: 'Guided onboarding for 4 weeks.' },
];

const productRecords: Record<string, typeof products.$inferSelect> = {};
for (const p of productSeed) {
  const [existing] = await db.select().from(products).where(eq(products.sku, p.sku)).limit(1);
  if (existing) {
    productRecords[p.sku] = existing;
    continue;
  }
  const [row] = await db.insert(products).values(p).returning();
  productRecords[p.sku] = row!;
}

const suite = productRecords['BL-SUITE']!;
const crm = productRecords['BL-CRM']!;
const seats = productRecords['BL-ADD-SSH']!;
const integ = productRecords['BL-ADD-INT']!;

/* variants — scene: "choosing the Odoo brand adds 560 to the price" */
const variantSeed = [
  { productId: suite.id, attribute: 'Brand', optionName: 'Odoo', priceDelta: 56000, skuSuffix: '-ODOO' },
  { productId: suite.id, attribute: 'Edition', optionName: 'Enterprise', priceDelta: 240000, skuSuffix: '-ENT' },
  { productId: crm.id, attribute: 'Brand', optionName: 'Odoo', priceDelta: 56000, skuSuffix: '-ODOO' },
];
for (const v of variantSeed) {
  const all = await db.select().from(productVariants).where(eq(productVariants.productId, v.productId));
  const exists = all.some((e) => e.attribute === v.attribute && e.optionName === v.optionName);
  if (!exists) await db.insert(productVariants).values(v);
}
const variantsByProduct = new Map<number, typeof productVariants.$inferSelect[]>();
for (const v of await db.select().from(productVariants)) {
  variantsByProduct.set(v.productId, [...(variantsByProduct.get(v.productId) ?? []), v]);
}

/* tax rules */
const taxSeed = [
  { name: 'GST 18%', rate: 1800, description: 'Standard 18% GST' },
  { name: 'GST 12%', rate: 1200, description: 'Reduced 12% GST' },
  { name: 'GST 0% (Exempt)', rate: 0, description: 'Zero-rated supplies' },
];
const taxRecords: Record<string, typeof taxRules.$inferSelect> = {};
for (const t of taxSeed) {
  const [existing] = await db.select().from(taxRules).where(eq(taxRules.name, t.name)).limit(1);
  if (existing) {
    taxRecords[t.name] = existing;
    continue;
  }
  const [row] = await db.insert(taxRules).values(t).returning();
  taxRecords[t.name] = row!;
}
const GST18 = taxRecords['GST 18%']!.id;
const GST12 = taxRecords['GST 12%']!.id;
const GST0 = taxRecords['GST 0% (Exempt)']!.id;

/* plans — mix of flags so every scene is demoable */
const planSeed = [
  { key: 'suite-m', productId: suite.id, taxes: [GST18], interval: 'monthly', name: 'Brightloop Suite — Monthly', description: 'The complete Brightloop Suite product with every addon line the workspace offers. Billed monthly with GST 18% applied to each invoice at confirm time.', price: 2499000, minQty: 1, autoRenew: true, allowPause: true, allowEarlyCancel: true, autoCloseAtEnd: false },
  { key: 'suite-y', productId: suite.id, taxes: [GST18], interval: 'yearly', name: 'Brightloop Suite — Yearly', description: 'The full Suite on annual commitment: one invoice a year, GST 18%. By design this plan cannot be paused or cancelled early.', price: 24990000, minQty: 1, autoRenew: true, allowPause: false, allowEarlyCancel: false, autoCloseAtEnd: false },
  { key: 'crm-m', productId: crm.id, taxes: [GST18], interval: 'monthly', name: 'Brightloop CRM — Monthly', description: 'The Brightloop CRM product alone, billed monthly with GST 18%. Priced per seat with a minimum of 3 seats.', price: 999000, minQty: 3, autoRenew: true, allowPause: true, allowEarlyCancel: true, autoCloseAtEnd: false },
  { key: 'crm-y', productId: crm.id, taxes: [GST18], interval: 'yearly', name: 'Brightloop CRM — Yearly', description: 'CRM on an annual cycle with GST 18%. The plan auto-closes when its validity ends and can be paused mid-term.', price: 9990000, minQty: 1, autoRenew: false, allowPause: true, allowEarlyCancel: true, autoCloseAtEnd: true },
  { key: 'seats-m', productId: seats.id, taxes: [GST12], interval: 'monthly', name: 'Extra Seat Pack — Monthly', description: 'Additional seats for an existing subscription, billed monthly with GST 12%. Sold in packs with a minimum of 5 seats.', price: 199000, minQty: 5, autoRenew: true, allowPause: true, allowEarlyCancel: true, autoCloseAtEnd: false },
  { key: 'integ-m', productId: integ.id, taxes: [GST0], interval: 'monthly', name: 'Advanced Integrations — Monthly', description: 'The Advanced Integrations addon: webhooks, API relay and scheduled exports. Billed monthly, exempt from GST (0%).', price: 149000, minQty: 1, autoRenew: true, allowPause: true, allowEarlyCancel: true, autoCloseAtEnd: false },
] as Array<{ key: string; productId: number; taxes: number[]; interval: IntervalKey; name: string; description: string; price: number; minQty: number; autoRenew: boolean; allowPause: boolean; allowEarlyCancel: boolean; autoCloseAtEnd: boolean }>;

type PlanRec = (typeof planSeed)[number] & { id: number };
const planRecords: Record<string, PlanRec> = {};
for (const p of planSeed) {
  const [existing] = await db.select().from(plans).where(eq(plans.name, p.name)).limit(1);
  if (existing) {
    planRecords[p.key] = { ...p, id: existing.id };
    continue;
  }
  const [row] = await db
    .insert(plans)
    .values({
      productId: p.productId,
      name: p.name,
      description: p.description,
      interval: p.interval,
      price: p.price,
      minQty: p.minQty,
      autoRenew: p.autoRenew,
      allowPause: p.allowPause,
      allowEarlyCancel: p.allowEarlyCancel,
      autoCloseAtEnd: p.autoCloseAtEnd,
    })
    .returning();
  planRecords[p.key] = { ...p, id: row!.id };
}

/* discounts — "Only the admin can create discount rules" */
const discountSeed = [
  { code: 'WELCOME10', name: '10% welcome offer', kind: 'percent', value: 1000, minQty: 0, maxUses: 200, scope: 'subscription', productId: null, endsAt: shiftDays(90) },
  { code: 'SEATS15', name: '15% for 5+ seats', kind: 'percent', value: 1500, minQty: 5, maxUses: 50, scope: 'product', productId: seats.id, endsAt: shiftDays(90) },
  { code: 'FLAT2K', name: '₹2,000 off bundle renewals', kind: 'fixed', value: 200000, minQty: 0, maxUses: 30, scope: 'subscription', productId: null, endsAt: shiftDays(30) },
] as Array<{
  code: string;
  name: string;
  kind: 'percent' | 'fixed';
  value: number;
  minQty: number;
  maxUses: number;
  scope: 'subscription' | 'product';
  productId: number | null;
  endsAt: string;
}>;

for (const d of discountSeed) {
  const [existing] = await db.select().from(discountRules).where(eq(discountRules.code, d.code)).limit(1);
  if (existing) continue;
  await db.insert(discountRules).values({ ...d, createdBy: admin.id });
}

/* quote template */
let [template] = await db.select().from(quoteTemplates).where(eq(quoteTemplates.name, 'Enterprise Bundle')).limit(1);
if (!template) {
  const [t] = await db
    .insert(quoteTemplates)
    .values({ name: 'Enterprise Bundle', description: 'Suite (yearly) + 10 seats + integrations', validDays: 30 })
    .returning();
  template = t!;
  await db.insert(quoteTemplateLines).values([
    { templateId: template.id, productId: suite.id, quantity: 1, unitPrice: 24990000 },
    { templateId: template.id, productId: seats.id, quantity: 10, unitPrice: 199000 },
    { templateId: template.id, productId: integ.id, quantity: 1, unitPrice: 149000 },
  ]);
}

/* --------------------------------------------------- subscriptions history */
const subRows = (await pool.query<{ c: number }>('select count(*)::int as c from subscriptions')).rows;
const subCount = subRows[0]?.c ?? 0;

if (subCount === 0) {
  /**
   * create a subscription directly in a target lifecycle state
   * (bypasses FSM on purpose: seed handles its own history)
   */
  async function seedSubscription(opts: {
    customer: typeof customers.$inferSelect;
    planKey: string;
    quantity: number;
    startDaysAgo: number;
    status: 'draft' | 'quotation' | 'confirmed' | 'active' | 'paused' | 'closed' | 'cancelled';
    terms?: 'immediate' | 'net15' | 'net30' | 'net45';
    discounts?: string[];
    useOdooVariant?: boolean;
  }) {
    const planList = planSeed as Array<{ key: string; productId: number; taxes: number[]; interval: IntervalKey; name: string; price: number; minQty: number; autoRenew: boolean; allowPause: boolean; allowEarlyCancel: boolean; autoCloseAtEnd: boolean }>;
    const plan = planRecords[opts.planKey] ?? (planList.find((p) => p.key === opts.planKey) as PlanRec | undefined);
    if (!plan) {
      throw new Error(`Seed plan ${String(opts.planKey)} missing`);
    }
    const start = shiftDays(-opts.startDaysAgo);
    const number = await nextNumber('subscription');

    const interval = INTERVAL_DAYS[plan.interval];    const isOpenEndedStages = ['active', 'paused', 'closed'].includes(opts.status);
    const expiry = isOpenEndedStages ? shiftDays(interval - opts.startDaysAgo) : null;
    // next billing stays in the past for active sub => the billing run has something to do
    const nextBilling =
      opts.status === 'active'
        ? shiftDays(-((opts.startDaysAgo % interval) || interval))
        : null;

    const variants = variantsByProduct.get(plan.productId) ?? [];
    const odoo = opts.useOdooVariant ? variants.find((v) => v.optionName === 'Odoo') ?? null : null;
    const unitPrice = plan.price + (odoo?.priceDelta ?? 0);

    const [sub] = await db
      .insert(subscriptions)
      .values({
        number,
        customerId: opts.customer.id,
        planId: plan.id,
        paymentTerms: opts.terms ?? 'net15',
        quantity: opts.quantity,
        status: opts.status,
        startDate: start,
        expiryDate: expiry,
        nextBillingDate: nextBilling,
        lastBillingDate: isOpenEndedStages ? start : null,
        templateId: null,
        autoRenew: plan.autoRenew,
      })
      .returning();

    const [line] = await db
      .insert(subscriptionLines)
      .values({
        subscriptionId: sub!.id,
        productId: plan.productId,
        variantId: odoo?.id ?? null,
        planId: plan.id,
        quantity: opts.quantity,
        unitPrice,
      })
      .returning();
    if (plan.taxes.length > 0) {
      await db
        .insert(subscriptionLineTaxes)
        .values(plan.taxes.map((tid) => ({ lineId: line!.id, taxRuleId: tid })));
    }
    if (opts.discounts?.length) {
      const rules = await db.select().from(discountRules).where(inArray(discountRules.code, opts.discounts));
      for (const r of rules.filter((r) => r.scope === 'subscription')) {
        await db
          .insert(subscriptionDiscounts)
          .values({ subscriptionId: sub!.id, ruleId: r.id })
          .onConflictDoNothing();
      }
    }
    await db.insert(subscriptionEvents).values({
      subscriptionId: sub!.id,
      type: opts.status === 'active' ? 'activated' : opts.status,
      toStatus: opts.status,
      message: 'Seeded demo history',
    });
    return sub!;
  }

  const [sunrise, acme, nirvana, bluetide, marble] = customerRecords;
  await seedSubscription({ customer: sunrise!, planKey: 'suite-m', quantity: 1, startDaysAgo: 35, status: 'active', discounts: ['WELCOME10'] });
  await seedSubscription({ customer: sunrise!, planKey: 'seats-m', quantity: 8, startDaysAgo: 35, status: 'active', discounts: ['SEATS15'] });
  await seedSubscription({ customer: acme!, planKey: 'suite-y', quantity: 1, startDaysAgo: 40, status: 'active', terms: 'net30', useOdooVariant: true });
  await seedSubscription({ customer: acme!, planKey: 'crm-y', quantity: 1, startDaysAgo: 400, status: 'closed' });
  await seedSubscription({ customer: nirvana!, planKey: 'crm-m', quantity: 12, startDaysAgo: 20, status: 'quotation' });
  await seedSubscription({ customer: nirvana!, planKey: 'integ-m', quantity: 1, startDaysAgo: 20, status: 'draft' });
  await seedSubscription({ customer: bluetide!, planKey: 'crm-m', quantity: 5, startDaysAgo: 10, status: 'confirmed' });
  await seedSubscription({ customer: bluetide!, planKey: 'suite-m', quantity: 1, startDaysAgo: 200, status: 'paused' });
  await seedSubscription({ customer: marble!, planKey: 'crm-y', quantity: 1, startDaysAgo: 380, status: 'active' });
  await seedSubscription({ customer: marble!, planKey: 'seats-m', quantity: 6, startDaysAgo: 15, status: 'cancelled', discounts: ['SEATS15'] });
  await seedSubscription({ customer: nirvana!, planKey: 'suite-m', quantity: 1, startDaysAgo: 15, status: 'active' });
  await seedSubscription({ customer: sunrise!, planKey: 'integ-m', quantity: 1, startDaysAgo: 60, status: 'cancelled' });

  console.log('✓ subscriptions seeded');
}

/* ------------------------------------------------- run the REAL billing run */
const { runBilling } = await import('../services/billing.service.js');
const run = await runBilling(admin.id);
console.log(`✓ billing run: created=${run.created} skipped=${run.skipped} renewed=${run.renewed} closed=${run.closed}`);

/* ------------------------------------------ shape confirm/pay/overdue states */
// idempotent guard: only shape invoices that are still drafts from THIS seed pass
const due = await db.select({ id: invoices.id, total: invoices.total, customerId: invoices.customerId }).from(invoices).where(eq(invoices.status, 'draft'));

// confirm most of them; simulate some overdue (due date passed), some future due
for (let i = 0; i < due.length; i++) {
  const inv = due[i]!;
  const profile = i * 7 % 10; // deterministic distribution across the batch
  let dueDate: string;
  let confirm: boolean;
  if (profile < 3) {
    confirm = true;
    dueDate = shiftDays(-15 - (i % 10)); // OVERDUE: 15-25 days past
  } else if (profile < 8) {
    confirm = true;
    dueDate = shiftDays(5 + (i % 12)); // on-time upcoming
  } else {
    confirm = false; // stays draft
    dueDate = shiftDays(3);
  }
  if (confirm) {
    await pool.query("UPDATE invoices SET status='confirmed', due_date=$2 WHERE id=$1", [inv.id, dueDate]);
  }
}

// payments: pay off ~60% of confirmed (mix of methods + one partial)
// paid invoices are BACKDATED across ~6 months so the revenue charts have history
const confirmed = await db.select({ id: invoices.id, total: invoices.total, customerId: invoices.customerId }).from(invoices).where(eq(invoices.status, 'confirmed'));
const methods = ['card', 'bank_transfer', 'upi', 'cash', 'cheque'] as const;
let paidCount = 0;
for (let i = 0; i < confirmed.length; i++) {
  const inv = confirmed[i]!;
  if (i * 3 % 5 === 0) continue; // ~40% stay outstanding (chase list for the dashboard)
  const partial = i * 7 % 10 === 6; // one or two partial payments
  const amount = partial ? Math.max(100, Math.floor(inv.total * 0.4)) : inv.total;
  const method = methods[i % methods.length]!;
  // spread across the last ~6 months (deterministic), keeping a recency tail
  const monthsBack = Math.floor(i / 2) % 6;
  const paidAt = shiftDays(-(monthsBack * 30 + (i % 22) + 1));
  await pool.query(
    `INSERT INTO payments (invoice_id, customer_id, method, amount, paid_at, reference, note)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [inv.id, inv.customerId, method, amount, paidAt, `PM-${1000 + paidCount}`, partial ? 'Part payment received' : 'Settled in full'],
  );
  // the invoice was issued ~5 days before its payment
  await pool.query(`UPDATE invoices SET paid_total = $2, status = CASE WHEN $2 >= total THEN 'paid' ELSE status END, issue_date = $3, due_date = $4 WHERE id = $1`, [
    inv.id,
    amount,
    shiftDays(-(monthsBack * 30 + (i % 22) + 6)),
    shiftDays(-(monthsBack * 30) + 5),
  ]);
  paidCount++;
}
console.log(`✓ ${paidCount} payments recorded (spread across 6 months for the charts)`);

/* ------------------------------------------ historical revenue for charts */
// One settled invoice per active subscription for each of the previous 5
// months, written straight (the seed bypasses the FSM on purpose). This is
// what gives /reports its multi-month series.
const actives = await pool.query<{ id: number; customer_id: number; plan_id: number; quantity: number }>(
  `SELECT id, customer_id, plan_id, quantity FROM subscriptions WHERE status = 'active' ORDER BY id`,
);
const planRows = await pool.query<{ id: number; price: number; name: string }>('SELECT id, price, name FROM plans');
let histCount = 0;
for (let m = 5; m >= 1; m--) {
  for (const [si, sub] of actives.rows.entries()) {
    if ((si + m) % 2 === 0) continue; // deterministic variety, not every sub every month
    // plans.id is bigserial → pg hands it back as a string; compare numerically
    const plan = planRows.rows.find((p) => Number(p.id) === Number(sub.plan_id));
    if (!plan) continue;
    console.log(`  (history: creating month -${m} for sub #${sub.id} plan ${plan.name})`);
    const subtotal = plan.price * sub.quantity;
    const taxTotal = Math.round(subtotal * 0.18); // seeded lines carry GST 18%
    const total = subtotal + taxTotal;
    const issueDate = shiftDays(-(m * 30 + 24) + ((si * 3) % 6));
    const paidAt = shiftDays(-(m * 30) - ((si * 5) % 12));
    const number = await nextNumber('invoice');
    const inv = await pool.query<{ id: number }>(
      `INSERT INTO invoices (number, subscription_id, customer_id, status, issue_date, due_date, period_start, period_end, subtotal, discount_total, tax_total, total, paid_total)
       VALUES ($1,$2,$3,'paid',$4,$5,$6,$7,$8,0,$9,$10,$10) RETURNING id`,
      [number, sub.id, sub.customer_id, issueDate, shiftDays(-(m * 30) + 6), shiftDays(-(m * 30 + 30)), shiftDays(-(m * 30)), subtotal, taxTotal, total],
    );
    await pool.query(
      `INSERT INTO invoice_lines (invoice_id, description, quantity, unit_price, tax_total, subtotal, total)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [inv.rows[0]!.id, `${plan.name} — monthly billing`, sub.quantity, plan.price, taxTotal, subtotal, subtotal + taxTotal],
    );
    await pool.query(
      `INSERT INTO payments (invoice_id, customer_id, method, amount, paid_at, reference, note)
       VALUES ($1,$2,$3,$4,$5,$6,'Historical settlement')`,
      [inv.rows[0]!.id, sub.customer_id, methods[(si + m) % methods.length], total, paidAt, `PM-${2000 + histCount}`],
    );
    histCount++;
  }
}
console.log(`✓ ${histCount} historical invoices settled (chart history)`);

console.log('\nDemo accounts (password: ' + env.SEED_PASSWORD + ')');
console.log('  admin@brightloop.dev · staff@brightloop.dev · customer@brightloop.dev · customer2@brightloop.dev');
await pool.end();
process.exit(0);

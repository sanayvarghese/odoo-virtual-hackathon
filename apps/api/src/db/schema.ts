/**
 * Brightloop database schema (Drizzle ORM / PostgreSQL).
 *
 * Conventions:
 *  - ALL money is stored as integer minimorum centenas (bigint mode:'number'), NEVER floats.
 *  - Every FK gets an index (dashboard filters must answer <2s on thousands of rows).
 *  - Status transitions are enforced in the FSM service, but CHECK-constrained at the DB too.
 *
 * Diagram: see README (auto-generated with drizzle-erd).
 */
import { relations, sql } from 'drizzle-orm';
import {
  bigserial,
  bigint,
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
  bigint as int8,
} from 'drizzle-orm/pg-core';

/* ------------------------------------------------------------------ enums */

export const userRole = pgEnum('user_role', ['admin', 'staff', 'customer']);
export const billingInterval = pgEnum('billing_interval', ['daily', 'weekly', 'monthly', 'yearly']);
export const paymentTermEnum = pgEnum('payment_term', ['immediate', 'net15', 'net30', 'net45']);
export const subscriptionStatus = pgEnum('subscription_status', [
  'draft',
  'quotation',
  'confirmed',
  'active',
  'paused',
  'closed',
  'cancelled',
]);
export const invoiceStatus = pgEnum('invoice_status', [
  'draft',
  'confirmed',
  'paid',
  'cancelled',
]);
export const paymentMethod = pgEnum('payment_method', [
  'cash',
  'card',
  'bank_transfer',
  'upi',
  'cheque',
]);
export const discountKind = pgEnum('discount_kind', ['fixed', 'percent']);
export const discountScope = pgEnum('discount_scope', ['product', 'subscription']);
export const tokenPurpose = pgEnum('token_purpose', ['verify_email', 'reset_password']);
export const importEntity = pgEnum('import_entity', ['product', 'plan', 'customer']);
export const importStatus = pgEnum('import_status', ['previewed', 'committed', 'failed']);

/* ------------------------------------------------------------- identity */

export const users = pgTable(
  'users',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    email: varchar('email', { length: 255 }).notNull(),
    passwordHash: text('password_hash').notNull(),
    role: userRole('role').notNull().default('customer'),
    name: varchar('name', { length: 120 }).notNull(),
    emailVerified: boolean('email_verified').notNull().default(false),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // One email belongs to one account only (scene: "Each email can belong to only one account")
    uniqueIndex('users_email_unique').on(sql`lower(${t.email})`),
    index('users_role_idx').on(t.role),
  ],
);

export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: varchar('token_hash', { length: 64 }).notNull().unique(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    ip: varchar('ip', { length: 64 }),
    userAgent: text('user_agent'),
  },
  (t) => [index('sessions_user_idx').on(t.userId), index('sessions_expires_idx').on(t.expiresAt)],
);

export const emailTokens = pgTable(
  'email_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    purpose: tokenPurpose('purpose').notNull(),
    tokenHash: varchar('token_hash', { length: 64 }).notNull().unique(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('email_tokens_user_idx').on(t.userId, t.purpose)],
);

/* ------------------------------------------------------------ customers */

export const customers = pgTable(
  'customers',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' })
      .unique(),
    companyName: varchar('company_name', { length: 200 }).notNull(),
    contactName: varchar('contact_name', { length: 120 }),
    phone: varchar('phone', { length: 32 }),
    address: text('address'),
    taxId: varchar('tax_id', { length: 64 }),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('customers_company_idx').on(t.companyName)],
);

/* --------------------------------------------------------- catalog: products */

export const products = pgTable(
  'products',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    sku: varchar('sku', { length: 64 }).notNull(),
    name: varchar('name', { length: 200 }).notNull(),
    kind: varchar('kind', { length: 40 }).notNull().default('software'), // software | addon | service
    salesPrice: bigint('sales_price', { mode: 'number' }).notNull().default(0), // cents
    costPrice: bigint('cost_price', { mode: 'number' }).notNull().default(0), // cents
    notes: text('notes'),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('products_sku_idx').on(t.sku),
    index('products_active_idx').on(t.isActive),
    check('products_price_ok', sql`${t.salesPrice} >= 0 AND ${t.costPrice} >= 0`),
  ],
);

/** e.g. variantOption "Odoo" adds cents 56000 to the price (scene: "choosing the Odoo brand adds 560") */
export const productVariants = pgTable(
  'product_variants',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    productId: integer('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    attribute: varchar('attribute', { length: 60 }).notNull(), // e.g. "Brand" / "Edition"
    optionName: varchar('option_name', { length: 120 }).notNull(), // e.g. "Odoo"
    priceDelta: bigint('price_delta', { mode: 'number' }).notNull().default(0), // cents added
    skuSuffix: varchar('sku_suffix', { length: 32 }),
  },
  (t) => [
    index('product_variants_product_idx').on(t.productId),
    uniqueIndex('product_variants_unique').on(t.productId, t.attribute, t.optionName),
  ],
);

/* ---------------------------------------------------------------- plans */

export const plans = pgTable(
  'plans',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    productId: integer('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'restrict' }),
    variantId: integer('variant_id').references(() => productVariants.id, {
      onDelete: 'set null',
    }),
    name: varchar('name', { length: 200 }).notNull(),
    description: text('description'),
    interval: billingInterval('interval').notNull(),
    price: bigint('price', { mode: 'number' }).notNull(), // per billing period, cents
    minQty: integer('min_qty').notNull().default(1), // scene: "the minimum quantity"
    validFrom: date('valid_from').notNull().defaultNow(), // scene: "dates it is available"
    validTo: date('valid_to'), // null = no end date
    // Scene: "Some plans should close on their own when they end, and others can be
    // closed early, paused or renewed. The admin decides which, plan by plan."
    autoCloseAtEnd: boolean('auto_close_at_end').notNull().default(false),
    allowPause: boolean('allow_pause').notNull().default(true),
    allowEarlyCancel: boolean('allow_early_cancel').notNull().default(true),
    autoRenew: boolean('auto_renew').notNull().default(true),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('plans_product_idx').on(t.productId),
    index('plans_interval_idx').on(t.interval),
    check('plans_price_ok', sql`${t.price} >= 0`),
    check('plans_min_qty_ok', sql`${t.minQty} >= 1`),
  ],
);

/* ------------------------------------------------------------ tax rules */

export const taxRules = pgTable(
  'tax_rules',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    name: varchar('name', { length: 120 }).notNull(), // e.g. "GST 18%"
    rate: bigint('rate', { mode: 'number' }).notNull(), // percent * 100 -> 1800 = 18.00 %
    description: text('description'),
    isActive: boolean('is_active').notNull().default(true),
  },
  (t) => [
    uniqueIndex('tax_rules_name_idx').on(t.name),
    check('tax_rate_ok', sql`${t.rate} >= 0 AND ${t.rate} <= 10000`),
  ],
);

/* ------------------------------------------------------------ discounts */

export const discountRules = pgTable(
  'discount_rules',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    code: varchar('code', { length: 40 }).notNull(),
    name: varchar('name', { length: 200 }).notNull(),
    kind: discountKind('kind').notNull(), // fixed amount | percent
    value: bigint('value', { mode: 'number' }).notNull(), // cents (fixed) or percent*100
    minPurchase: bigint('min_purchase', { mode: 'number' }).notNull().default(0),
    minQty: integer('min_qty').notNull().default(0),
    startsAt: date('starts_at').notNull().defaultNow(),
    endsAt: date('ends_at'),
    maxUses: integer('max_uses'), // null = unlimited
    usedCount: integer('used_count').notNull().default(0),
    scope: discountScope('scope').notNull(), // product-specific | whole subscription
    productId: integer('product_id').references(() => products.id, { onDelete: 'cascade' }),
    isActive: boolean('is_active').notNull().default(true),
    createdBy: integer('created_by').references(() => users.id, { onDelete: 'set null' }),
  },
  (t) => [
    uniqueIndex('discount_code_idx').on(t.code),
    index('discount_active_idx').on(t.isActive, t.startsAt, t.endsAt),
    check('discount_value_ok', sql`${t.value} >= 0`),
  ],
);

export const discountUsages = pgTable(
  'discount_usages',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    ruleId: integer('rule_id')
      .notNull()
      .references(() => discountRules.id, { onDelete: 'cascade' }),
    subscriptionId: integer('subscription_id'),
    invoiceId: integer('invoice_id'),
    usedAt: timestamp('used_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('discount_usages_rule_idx').on(t.ruleId)],
);

/* ------------------------------------------------ quote templates */

export const quoteTemplates = pgTable(
  'quote_templates',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    name: varchar('name', { length: 200 }).notNull(),
    description: text('description'),
    validDays: integer('valid_days').notNull().default(30), // stay valid for N days
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [check('qt_valid_days_ok', sql`${t.validDays} >= 1`)],
);

export const quoteTemplateLines = pgTable(
  'quote_template_lines',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    templateId: integer('template_id')
      .notNull()
      .references(() => quoteTemplates.id, { onDelete: 'cascade' }),
    productId: integer('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'restrict' }),
    variantId: integer('variant_id').references(() => productVariants.id, { onDelete: 'set null' }),
    planId: integer('plan_id').references(() => plans.id, { onDelete: 'set null' }),
    quantity: integer('quantity').notNull().default(1),
    unitPrice: bigint('unit_price', { mode: 'number' }).notNull(), // override price, cents
  },
  (t) => [index('qt_lines_template_idx').on(t.templateId)],
);

/* -------------------------------------------------------- subscriptions */

export const subscriptions = pgTable(
  'subscriptions',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    number: varchar('number', { length: 24 }).notNull().unique(), // SUB-2025-00001
    customerId: integer('customer_id')
      .notNull()
      .references(() => customers.id, { onDelete: 'restrict' }),
    planId: integer('plan_id')
      .notNull()
      .references(() => plans.id, { onDelete: 'restrict' }),
    templateId: integer('template_id').references(() => quoteTemplates.id, { onDelete: 'set null' }),
    paymentTerms: paymentTermEnum('payment_terms').notNull().default('net15'),
    quantity: integer('quantity').notNull().default(1),
    status: subscriptionStatus('status').notNull().default('draft'),
    startDate: date('start_date').notNull(),
    expiryDate: date('expiry_date'), // contract end; null = open ended
    nextBillingDate: date('next_billing_date'),
    lastBillingDate: date('last_billing_date'),
    validUntil: date('valid_until'), // quotation lifetime for draft/quotation status
    autoRenew: boolean('auto_renew').notNull().default(true), // overridable per subscription
    notes: text('notes'),
    createdBy: integer('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('subs_customer_idx').on(t.customerId),
    index('subs_status_idx').on(t.status),
    index('subs_next_billing_idx').on(t.nextBillingDate),
    index('subs_number_idx').on(t.number),
  ],
);

/** Lines: "product, quantity, unit price, taxes and amount" */
export const subscriptionLines = pgTable(
  'subscription_lines',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    subscriptionId: integer('subscription_id')
      .notNull()
      .references(() => subscriptions.id, { onDelete: 'cascade' }),
    productId: integer('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'restrict' }),
    variantId: integer('variant_id').references(() => productVariants.id, { onDelete: 'set null' }),
    planId: integer('plan_id').references(() => plans.id, { onDelete: 'set null' }),
    quantity: integer('quantity').notNull().default(1),
    unitPrice: bigint('unit_price', { mode: 'number' }).notNull(),
  },
  (t) => [index('sub_lines_sub_idx').on(t.subscriptionId)],
);

export const subscriptionLineTaxes = pgTable(
  'subscription_line_taxes',
  {
    lineId: integer('line_id')
      .notNull()
      .references(() => subscriptionLines.id, { onDelete: 'cascade' }),
    taxRuleId: integer('tax_rule_id')
      .notNull()
      .references(() => taxRules.id, { onDelete: 'restrict' }),
  },
  (t) => [primaryKey({ columns: [t.lineId, t.taxRuleId] })],
);

export const subscriptionDiscounts = pgTable(
  'subscription_discounts',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    subscriptionId: integer('subscription_id')
      .notNull()
      .references(() => subscriptions.id, { onDelete: 'cascade' }),
    ruleId: integer('rule_id')
      .notNull()
      .references(() => discountRules.id, { onDelete: 'restrict' }),
  },
  (t) => [uniqueIndex('sub_discount_unique').on(t.subscriptionId, t.ruleId)],
);

/** Renewal/pause/cancel timeline shown on the detail page */
export const subscriptionEvents = pgTable(
  'subscription_events',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    subscriptionId: integer('subscription_id')
      .notNull()
      .references(() => subscriptions.id, { onDelete: 'cascade' }),
    type: varchar('type', { length: 40 }).notNull(), // created | sent | confirmed | activated | paused | resumed | renewed | cancelled | closed
    message: text('message'),
    fromStatus: varchar('from_status', { length: 20 }),
    toStatus: varchar('to_status', { length: 20 }),
    actorId: integer('actor_id').references(() => users.id, { onDelete: 'set null' }),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('sub_events_sub_idx').on(t.subscriptionId, t.at)],
);

/* ------------------------------------------------------------- invoices */

export const invoices = pgTable(
  'invoices',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    number: varchar('number', { length: 24 }).notNull().unique(), // INV-2025-00001
    subscriptionId: integer('subscription_id').references(() => subscriptions.id, {
      onDelete: 'set null',
    }),
    customerId: integer('customer_id')
      .notNull()
      .references(() => customers.id, { onDelete: 'restrict' }),
    status: invoiceStatus('status').notNull().default('draft'),
    issueDate: date('issue_date').notNull(),
    dueDate: date('due_date'), // from subscription payment terms
    periodStart: date('period_start'), // billing period anchor (idempotency key)
    periodEnd: date('period_end'),
    subtotal: bigint('subtotal', { mode: 'number' }).notNull().default(0),
    discountTotal: bigint('discount_total', { mode: 'number' }).notNull().default(0),
    taxTotal: bigint('tax_total', { mode: 'number' }).notNull().default(0),
    total: bigint('total', { mode: 'number' }).notNull().default(0),
    paidTotal: bigint('paid_total', { mode: 'number' }).notNull().default(0),
    notes: text('notes'),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('inv_customer_idx').on(t.customerId),
    index('inv_status_idx').on(t.status),
    index('inv_due_date_idx').on(t.dueDate),
    index('inv_subscription_idx').on(t.subscriptionId),
    // NO DOUBLE BILLING: one invoice per subscription per billing period (scene: "Nothing should be billed twice")
    uniqueIndex('inv_not_billed_twice').on(
      t.subscriptionId,
      t.periodStart,
    ),
  ],
);

export const invoiceLines = pgTable(
  'invoice_lines',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    invoiceId: integer('invoice_id')
      .notNull()
      .references(() => invoices.id, { onDelete: 'cascade' }),
    productId: integer('product_id').references(() => products.id, { onDelete: 'set null' }),
    variantId: integer('variant_id').references(() => productVariants.id, { onDelete: 'set null' }),
    description: varchar('description', { length: 300 }).notNull(),
    quantity: integer('quantity').notNull().default(1),
    unitPrice: bigint('unit_price', { mode: 'number' }).notNull(),
    taxTotal: bigint('tax_total', { mode: 'number' }).notNull().default(0),
    subtotal: bigint('subtotal', { mode: 'number' }).notNull(), // qty * unit price
    total: bigint('total', { mode: 'number' }).notNull(), // subtotal + tax
  },
  (t) => [index('inv_lines_invoice_idx').on(t.invoiceId)],
);

export const invoiceLineTaxes = pgTable(
  'invoice_line_taxes',
  {
    lineId: integer('line_id')
      .notNull()
      .references(() => invoiceLines.id, { onDelete: 'cascade' }),
    taxRuleId: integer('tax_rule_id')
      .notNull()
      .references(() => taxRules.id, { onDelete: 'restrict' }),
    rate: bigint('rate', { mode: 'number' }).notNull(), // snapshot at issue time
  },
  (t) => [primaryKey({ columns: [t.lineId, t.taxRuleId] })],
);

/** Discount snapshot at issue time (also shown as own line on the invoice) */
export const invoiceDiscounts = pgTable(
  'invoice_discounts',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    invoiceId: integer('invoice_id')
      .notNull()
      .references(() => invoices.id, { onDelete: 'cascade' }),
    ruleId: integer('rule_id').references(() => discountRules.id, { onDelete: 'set null' }),
    label: varchar('label', { length: 200 }).notNull(),
    amount: bigint('amount', { mode: 'number' }).notNull(),
  },
  (t) => [index('inv_discounts_invoice_idx').on(t.invoiceId)],
);

/* -------------------------------------------------------------- payments */

export const payments = pgTable(
  'payments',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    invoiceId: integer('invoice_id')
      .notNull()
      .references(() => invoices.id, { onDelete: 'cascade' }),
    customerId: integer('customer_id')
      .notNull()
      .references(() => customers.id, { onDelete: 'restrict' }),
    method: paymentMethod('method').notNull(),
    amount: bigint('amount', { mode: 'number' }).notNull(),
    paidAt: date('paid_at').notNull(),
    reference: varchar('reference', { length: 80 }),
    note: text('note'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('payments_invoice_idx').on(t.invoiceId),
    index('payments_paid_at_idx').on(t.paidAt),
    index('payments_customer_idx').on(t.customerId),
  ],
);

/* ------------------------------------------------------- numbering + audit */

export const numberings = pgTable(
  'numberings',
  {
    entity: varchar('entity', { length: 30 }).notNull(), // 'subscription' | 'invoice'
    year: smallint('year').notNull(),
    last: integer('last').notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.entity, t.year] })],
);

export const auditLog = pgTable(
  'audit_log',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    actorId: integer('actor_id').references(() => users.id, { onDelete: 'set null' }),
    action: varchar('action', { length: 60 }).notNull(),
    entity: varchar('entity', { length: 40 }).notNull(),
    entityId: bigint('entity_id', { mode: 'number' }),
    summary: text('summary'),
    before: jsonb('before'),
    after: jsonb('after'),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('audit_entity_idx').on(t.entity, t.entityId), index('audit_at_idx').on(t.at)],
);

/* --------------------------------------------------------- AI import jobs */

export const aiImportJobs = pgTable('ai_import_jobs', {
  id: uuid('id').primaryKey().defaultRandom(),
  createdBy: integer('created_by').references(() => users.id, { onDelete: 'set null' }),
  filename: varchar('filename', { length: 255 }).notNull(),
  entity: importEntity('entity').notNull(),
  status: importStatus('status').notNull().default('previewed'),
  headerMap: jsonb('header_map'), // LLM-proposed column mapping
  rows: jsonb('rows'), // staged, validated rows
  validCount: integer('valid_count').notNull().default(0),
  invalidCount: integer('invalid_count').notNull().default(0),
  committedCount: integer('committed_count').notNull().default(0),
  errors: jsonb('errors'),
  result: jsonb('result'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  committedAt: timestamp('committed_at', { withTimezone: true }),
});

/* -------------------------------------------------------------- relations */

export const usersRelations = relations(users, ({ one }) => ({
  customer: one(customers, { fields: [users.id], references: [customers.userId] }),
}));

export const productsRelations = relations(products, ({ many }) => ({
  variants: many(productVariants),
  plans: many(plans),
}));

export const productVariantsRelations = relations(productVariants, ({ one }) => ({
  product: one(products, { fields: [productVariants.productId], references: [products.id] }),
}));

export const plansRelations = relations(plans, ({ one }) => ({
  product: one(products, { fields: [plans.productId], references: [products.id] }),
}));

export const subscriptionsRelations = relations(subscriptions, ({ one, many }) => ({
  customer: one(customers, { fields: [subscriptions.customerId], references: [customers.id] }),
  plan: one(plans, { fields: [subscriptions.planId], references: [plans.id] }),
  lines: many(subscriptionLines),
  events: many(subscriptionEvents),
  invoices: many(invoices),
}));

export const invoiceLinesRelations = relations(invoiceLines, ({ one }) => ({
  invoice: one(invoices, { fields: [invoiceLines.invoiceId], references: [invoices.id] }),
}));

export const invoicesRelations = relations(invoices, ({ one, many }) => ({
  customer: one(customers, { fields: [invoices.customerId], references: [customers.id] }),
  subscription: one(subscriptions, {
    fields: [invoices.subscriptionId],
    references: [subscriptions.id],
  }),
  lines: many(invoiceLines),
  payments: many(payments),
}));

/* ------------------------------------------------------------------ types */

export type User = typeof users.$inferSelect;
export type Customer = typeof customers.$inferSelect;
export type Product = typeof products.$inferSelect;
export type ProductVariant = typeof productVariants.$inferSelect;
export type Plan = typeof plans.$inferSelect;
export type TaxRule = typeof taxRules.$inferSelect;
export type DiscountRule = typeof discountRules.$inferSelect;
export type QuoteTemplate = typeof quoteTemplates.$inferSelect;
export type Subscription = typeof subscriptions.$inferSelect;
export type SubscriptionLine = typeof subscriptionLines.$inferSelect;
export type Invoice = typeof invoices.$inferSelect;
export type InvoiceLine = typeof invoiceLines.$inferSelect;
export type Payment = typeof payments.$inferSelect;

-- Brightloop reporting views (idempotent: CREATE OR REPLACE)
-- Finance-lead questions answered from these views so the dashboard stays <2s.

-- Normalized Monthly Recurring Revenue per customer: yearly/12, weekly *4, daily *30
CREATE OR REPLACE VIEW v_mrr AS
SELECT
  s.id                                AS subscription_id,
  s.customer_id,
  c.company_name,
  p.interval                          AS interval,
  l.quantity,
  l.unit_price                        AS unit_price,
  ROUND(
    CASE p.interval
      WHEN 'monthly' THEN l.quantity * l.unit_price
      WHEN 'yearly'  THEN (l.quantity * l.unit_price) / 12.0
      WHEN 'weekly'  THEN (l.quantity * l.unit_price) * 13.0 / 3.0
      WHEN 'daily'   THEN (l.quantity * l.unit_price) * 30.0
    END
  )                                   AS mrr_cents
FROM subscriptions s
JOIN customers c ON c.id = s.customer_id
JOIN plans    p  ON p.id = s.plan_id
JOIN subscription_lines l ON l.subscription_id = s.id
WHERE s.status IN ('active', 'paused');

-- Outstanding (unconfirmed-remaining) balance per confirmed invoice
CREATE OR REPLACE VIEW v_outstanding AS
SELECT
  i.id,
  i.number,
  i.customer_id,
  c.company_name,
  i.total - i.paid_total              AS balance_due,
  i.due_date,
  (i.due_date < CURRENT_DATE)         AS is_overdue,
  (CURRENT_DATE - i.due_date)         AS days_overdue
FROM invoices i
JOIN customers c ON c.id = i.customer_id
WHERE i.status = 'confirmed';

-- Cash collected per month (all roles of payments)
CREATE OR REPLACE VIEW v_revenue_monthly AS
SELECT
  date_trunc('month', pm.paid_at)::date AS month,
  SUM(pm.amount)                        AS revenue_cents,
  COUNT(*)                              AS payment_count
FROM payments pm
GROUP BY 1;

-- MRR total per month (point-in-time, useful for the trend chart)
CREATE OR REPLACE VIEW v_overdue AS
SELECT * FROM v_outstanding WHERE is_overdue;

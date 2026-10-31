# Brightloop — Subscription Management System (Odoo Virtual Hackathon)

> **HANDOFF DOCUMENT — READ THIS FIRST IF YOU ARE A NEW AGENT/DEVELOPER.**
> Every design decision, credential, convention and task is documented here.
> Pair this file with `PROGRESS.md` (live task status + session log).
> Problem statement: `ps.pdf` (extracted text in `ps.txt`). Judging criteria: `Expectations.txt`.

---

## 1. Team & Git conventions (4 members, git-switch)

Accounts are managed with `git-switch`:

| # | Name | Email | GitHub | Role |
|---|------|-------|--------|------|
| 1 | ALWIN ANTONY | u2408014@rajagiri.edu.in | alwinantony-13 | Auth, RBAC, security |
| 2 | JOHNU | johnniju77@gmail.com | johnniju | AI copilot (Ollama, bulk import) |
| 3 | MuhamedUllas | u2408056@rajagiri.edu.in | MuhamedUllas | Dashboards, reports, charts |
| 4 | **Sanay George Varghese** | helloto.sanay@gmail.com | sanayvarghese | **TEAM LEADER — core billing, schema, reviews, gets the most commits** |

**Commit attribution rule (IMPORTANT):**
- To commit as a member, run `git-switch switch <name>` BEFORE `git commit`
  (it changes repo-local git config, not global; commit right after).
- Distribution target: Sanay ≈ 40–45% of commits, others ≈ 15–20% each, split by feature ownership above.
- Commit style: conventional commits (`feat(auth): ...`, `fix(billing): ...`, `docs: ...`).
- Must include: descriptive body when non-trivial. Never `git config --global` changes.
- pushing to GitHub happens on `main`; members "own" their feature branches
  (`auth/…`, `ai/…`, `report/…`, `core/…` for leader) then merge to main. At minimum we must show
  varied authorship in history — squash merges keep author of merger, so merge --no-ff or fast-forward
  individually authored commits.

## 2. Locked-in stack decisions

- **Database:** local **PostgreSQL** (installed on machine; user `postgres`, password `root`, port 5432). DB name: `brightloop`.
  Connect with `postgres://postgres:root@localhost:5432/brightloop`.
- **Backend:** **Fastify + TypeScript** (`apps/api`). ORM: **Drizzle ORM + drizzle-kit** (explicit SQL migrations in `apps/api/drizzle/*.sql`, typed schema in `apps/api/src/db/schema.ts`) — chosen so judges see both type-safety AND the raw SQL. Aliases useful for manual SQL views.
- **Frontend:** **Next.js (App Router) + TypeScript + Tailwind CSS v4** (`apps/web`). React 19. No shadcn — custom components, design-system-first (skill files used: `.agents/skills/design-taste-frontend`, `.agents/skills/impeccable`, `.agents/skills/emil-design-eng`). Recharts for charts.
- **AI:** **Ollama** running locally. Model the user runs: **`qwen3.5:9b-q4_K_M`** (user-confirmed it exists in their Ollama). Endpoint `http://localhost:11434` (OpenAI-compatible `/v1/chat/completions` with tool calling). Model name must be configurable via env `OLLAMA_MODEL`, default `qwen3.5:9b-q4_K_M`.
- **File parsing:** `xlsx` npm package server-side for Excel/CSV; text files parsed in-code. Security: size cap 5MB, row cap 5,000.
- **Auth:** server-side sessions in Postgres + httpOnly cookie (`brightloop_session`). Argon2id via `@node-rs/argon2`. Password policy (from PS): >8 chars, 1 uppercase, 1 lowercase, 1 special char. CSRF: double-submit cookie + `Origin` check. Rate limit login/forgot/register.
- **Email flows** (verify, password reset): dev-only "mailbox" — tokens stored in `email_tokens` table and shown at `/dev/mailbox` page (documented clearly as a demo constraint). Reset link expires 30 min, single-use.
- **Package manager:** **npm workspaces** at repo root (`apps/api`, `apps/web`).
- **Ports:** API `http://localhost:4000`, Web `http://localhost:3000`, Postgres `5432`.

## 3. Architecture

```
repo root: package.json (npm workspaces), docker-less, PLAN.md, PROGRESS.md, ps.txt
apps/
  api/                    Fastify + TS
    src/
      server.ts           app factory (plugins: cors w/ origin allowlist, cookie, rate-limit, multipart, swagger)
      env.ts              zod-validated env
      db/
        schema.ts         drizzle schema (all tables below)
        client.ts         pg pool (max 10) + drizzle
        views.sql         SQL views (mrr, revenue, overdue) executed by migrate script
        migrations/       drizzle-kit SQL migrations (0000_xxx.sql, 0001_xxx.sql …)
      plugins/
        auth.ts           session cookie + loadSession preHandler + requireRole('admin'|'staff'|'customer'|any)
      routes/             (all under /api/v1)
        auth.routes.ts        register/login/logout/forgot/reset/verify/me
        users.routes.ts       admin-only staff management
        products.routes.ts     CRUD + variants + bulk import
        plans.routes.ts        CRUD (billing interval, min qty, validity dates, toggles: auto_close, allow_pause, allow_early_cancel, auto_renew)
        customers.routes.ts    staff/admin + admin-only add staff
        taxes.routes.ts        tax rule CRUD
        discounts.routes.ts    admin-only discount rule CRUD (+usage tracking)
        quote-templates.routes.ts  quotation template + lines CRUD (valid_days)
        subscriptions.routes.ts    lifecycle engine: create→draft, send(quotation), confirm, activate, pause/resume, renew, cancel, close; lines CRUD
        invoices.routes.ts     generate (billing run), confirm/cancel/send, my invoices (customer), print view data
        payments.routes.ts     record payment w/ method amount date note; outstanding lists
        reports.routes.ts      dashboard aggregates (admin/staff): active subs, revenue, outstanding, overdue; customer: own stats
        ai.routes.ts           POST /ai/chat (SSE stream, tools), POST /ai/import (upload → parse → map → preview), POST /ai/import/commit
        dev.routes.ts          dev mailbox (list tokens), demo seed/reset trigger (admin-only)
      services/           business logic (billing.service, subscription.service, discount.service, tax.service, ai/import.service, ai/agent.service, numbering.service)
      lib/                ollama client (chat + tools runner), validators (zod), money utils (integer cents everywhere!)
      seed/               seed.ts  Brightloop demo data (idempotent; run: npm run seed)
  web/                    Next.js app
    src/app/
      (public)/           landing page (hero, pricing, features), /products catalog, /login /signup /forgot-password /reset
      dev/mailbox/        dev-only token mailbox
      admin/              admin+staff console: dashboard, products (bulk import UI), plans, discounts, taxes,
                          templates, subscriptions (pipeline boards + detail w/ timeline), invoices (+print view), payments, reports, staff mgmt
      portal/             customer: my subscriptions (pause/renew/cancel per plan flags), my invoices (pay now), my usage/assistant
      chat/               AI assistant (floating dock, all roles; file upload for admin/staff)
    src/components/ui     Button, Input, Card, Table, Badge, Modal, Drawer, Toast, Tabs, KPI, etc.
    src/lib               api client (fetch wrapper, errors→toasts), money fmt, react-query (TanStack Query v5)
```

## 4. Database design (DRIZZLE SCHEMA SPEC — the #1 judged area)

All money is **integer cents** (`bigint`). All timestamps `timestamptz`. Compact but explicit onupdate/strict constraints.

1. `users(id bigserial PK, email citext UNIQUE, password_hash text, role enum('admin','staff','customer'), name, email_verified bool, created_at, updated_at, deleted_at)` — one email = one account (partial unique index on (lower(email)) where deleted_at is null).
2. `sessions(id uuid PK, user_id FK, token_hash char(64) UNIQUE (sha256), expires_at, created_at, ip, user_agent, revoked_at)`
3. `email_tokens(id, user_id FK, purpose enum('verify','reset'), token_hash CAP64 unique, expires_at, used_at)`
4. `customers(id bigserial PK, user_id FK unique, company_name, contact_name, phone, address, gstin, is_active, created_at, updated_at)`
5. `products(id, sku unique, name, kind enum('software','addon','vacuous'), price_cents (sales price), cost_cents, notes, is_active, created_at, updated_at)`
6. `product_variants(id, product_id FK, variant_of enum('brand','edition','size','region'), option_name (e.g. 'Odoo'), price_delta_cents e.g. 560, sku_suffix)`
7. `plans(id, product_id FK, name, billing_interval enum('daily','weekly','monthly','yearly'), price_cents, min_qty int, valid_from date, valid_to date null,
        flags: auto_close bool, allow_pause bool, allow_early_cancel bool, auto_renew bool, is_active, created/updated)`
8. `tax_rules(id, name, rate numeric(5,2) percent, kind enum('individual','group'), parent_tax_id FK null, is_active)`; PSI demands tax computed into invoice lines.
9. `discount_rules(id, code unique, name, kind enum('fixed','percent'), value_cents bigint (fixed) / percent numeric(5,2),
        min_purchase_cents, min_qty int, starts_at date, ends_at date, max_uses int null, scope enum('product','subscription'),
        product_id FK null, is_active, created_by FK)`
10. `discount_usages(id, rule_id FK, subscription_id FK, invoice_id FK null, used_at)`
11. `quote_templates(id, name, valid_days int (validity for quotes made from it), note, lines…)`
12. `quote_template_lines(id, template_id FK, product_id FK, qty, unit_price_cents, tax_ids bigint[] handled via JSON)`
13. `subscriptions(id bigserial PK, number text UNIQUE (e.g. SUB-2025-00001 from numbering service), customer_id FK, plan_id FK, payment_terms enum('immediate','net15','net30','net45'),
        status enum('draft','quotation','confirmed','active','paused','closed','cancelled'),
        start_date date, expiry_date date null, next_billing_date date, quantity,
        pause_started_at date null, billing_anchor date null, notes, template_id FK null, created_by FK, created/updated)`

    - `subscription_lines(id, subscription_id FK, product_id FK, product_variant_id FK null, qty, unit_price_cents, discount_rule_id FK null, tax_rule_ids bigint[] using separate join row? → simpler: line_taxes join table)`
    - `subscription_line_taxes(sub_line_id, tax_rule_id)` (join table)
14. `invoices(id bigserial PK, number text UNIQUE (INV-2025-00001), subscription_id FK null, customer_id FK, status enum('draft','confirmed','payment_due','paid','cancelled'), issue_date date, due_date date null,
        subtotal_cents, discount_cents, tax_cents, total_cents, paid_cents default 0, notes, created_at)`
    - **CRITICAL (no double billing):** `UNIQUE(subscription_id, billing_period_start)` where `billing_period_start` is the period anchor stored by the billing run — prevents re-generation of the same period in a second click.
    - `invoice_lines(id, invoice_id FK, description, product_id, variant_id, qty, unit_price_cents, tax_cents, amount_cents)`
    - `invoice_line_taxes(invoice_line_id, tax_rule_id)`
    - `invoice_discounts(invoice_id, rule_id, label, amount_cents)` (snapshot at time of issue)
15. `payments(id bigserial PK, invoice_id FK, payment_ref, organ type enum('cash','bank','card','upi','cheque'), amount_cents bigint, method enum('cash','card','bank_transfer','upi','cheque'), paid_at date, note text)`
16. `audit_log(id, actor_id FK users, action text, entity text, entity_id bigint, before jsonb, after jsonb, at timestamptz)`
17. `numberings(entity enum('subscription','invoice'), year int, last int, PRIMARY KEY(entity, year))` — atomic numbering via `INSERT ... ON CONFLICT DO UPDATE last = last + 1 RETURNING last`.
18. `ai_import_jobs(id bigserial, created_by FK, original_filename, status enum('parsed','previewed','committed','failed'), header map jsonb, rows jsonb (staged), valid_count, invalid_count, result jsonb, created_at)`

**Indexes needed (document in migration comments):** FKs, status, next_billing_date, due_date partial on unpaid, invoice status, discount code, subscriptions(customer). Dashboard aggregates are run from dedicated SQL **views**:
- `v_subscription_revenue`: revenue by subscription (joined invoices confirmed/paid)
- `v_mrr_monthly`: active subscription MRR (monthly normalized: yearly/12, weekly*4/1, daily*30)
- `v_outstanding`: unpaid confirmed invoices w/ amount, days overdue flag.

## 5. API design

All routes under `/api/v1`. All requests validated with Zod. Error format:
```json
{ "error": { "message": "human readable", "code": "validation_error|unauthorized|forbidden|not_found|conflict", "details": [ {path, message, row?} ] } }
```
Zod → error details handled by central error handler. 401 on unauth, 403 when role mismatch.
Full endpoint list (also documented by swagger at `/docs`):
- `POST /auth/register` (role=customer only; staff/admin can't self-register)
- `POST /auth/login`, `POST /auth/logout`, `GET /auth/me`, `GET /auth/csrf`
- `POST /auth/forgot`, `POST /auth/reset`
- `GET/POST/PATCH/DELETE /products`, `/products/:id/variants`
- `POST /products/import` (admin only): multipart upload (xlsx/csv) or co-branded with AI raw mode: `POST /ai/import`
- `/plans` CRUD (plan expiry settings: `closes_at_end`, `allow_pause`, `allow_early_cancel`, `auto_renew`)
- `/taxes` CRUD, `/discounts` CRUD, `/discounts/:id/deactivate`
- `/quote-templates` CRUD (+lines)
- `/customers` (staff view all, admin manage)
- `/staff` admin-only (create staff user)
- `/subscriptions` (create from template or scratch → `draft`; `PATCH /:id/send` → quotation; `POST /:id/confirm` → confirmed; `POST /:id/activate` → active; `POST /:id/renew`; `POST /:id/pause`; `POST /:id/resume`; `POST /:id/cancel`; `POST /:id/close`; status transitions validated via FSM service — illegal transitions 409 with explanatory message)
- `/subscriptions/:id/lines` CRUD
- `POST /billing/run` (admin) → generates draft invoices for all due subscriptions (idempotency via unique subscription+period constraint; returns counts)
- `POST /invoices/:id/confirm` (draft→confirmed sets tax + discount snapshot), `/invoices/:id/cancel`, `/invoices/:id/send` (dev mailbox), `GET /invoices/:id/print`
- `GET /invoices?status=&mine=` list w/ filters (mine maps to customer portal)
- `POST /payments` (records payment allocate to invoice; partial payments update paid_cents),  `GET /payments?invoiceId=`
- `GET /reports/summary` (KPI count, MRR, paid revenue, outstanding, overdue) + `GET /reports/series?metric=revenue|mrr|overdue&from&to&interval=month` (Recharts-ready arrays), each with role scoping (customer → own numbers only).
- AI:
  - `POST /ai/chat` — body { messages:[{role, text, attachmentIds} ] }; response streamed SSE: `event: token` / `event: tool_use` / `event: tool_result` / `event: done`.
  - `POST /ai/import` — multipart file OR { text } → parse→LLM header map→staged preview (jobId).
  - `POST /ai/import/:jobId/commit` — transactional insert of staged valid rows → returns created count + per-row errors for view.
- Dev utilities: `POST /dev/seed {scenario}`, `GET /dev/mailbox` (print wait — actually should be GET of tokens), `/docs` swagger UI.

## 6. AI copilot design — "Brightloop Copilot"

Four surfaces, one chat UI (floating dock; opens as side panel/drawer on desktop, sheet on mobile):
1. **Admin / Staff — Data Q&A** (tools: get_kpis, list_subscriptions(filter), list_overdue, revenue_by_period, get_invoice, find_customer, list_products...) each tool STRICTLY role-checked at server side (the LLM cannot bypass; tools execute via same services/routes-backed functions).
2. **Admin — Bulk import** via file/text: hybrid parser:
   - upload/.xlsx parsed with `xlsx` → JSON rows (fast, local);
   - rows NOT sent to LLM wholesale: send **headers + 5 sample rows** to LLM with strict JSON schema ask: `{rename: {csv_col: canonical_field}, entity: 'product'|'plan'|'discount', fieldTypes:{}, notes}`;
   - **deterministic mapper** applies map to all rows + zod validates each row individually (per-row, per-cell errors);
   - invalid rows: rows with formatting issues get a **soft-repair pass through LLM in batches of 20 max** (e.g. price "₹5,600." etc.) before final fail flag;
   - preview grid UI (green valid / red invalid w/ reason + editable?) → commit = one transaction with batched insert (chunks of 500);
   - every import is audited `ai_import_jobs`.
3. **Customer assistant** — tools scoped by session user (their own subscription info, invoices due, plan recommendation based on their product portfolio) explicitly allowed.
4. **Sales rep quote builder** (staff) — "prepare quote for Acme, 20 seats Pro yearly" → returns draft subscription JSON the rep reviews then confirms via normal API (never writes directly).

LLM implementation details:
- Ollama OpenAI compatible endpoint, `stream: true`, `tools` array (function calling), temperature 0.2, `max_tokens` 512 for answers, `num_ctx` 8192.
- Every response is tool-called loop capped at 4 iterations; final answer formatted with markdown-lite (renderer in web).
- Token streaming to client via SSE. Timeout 60s; healthcheck route `GET /ai/health` pings Ollama.
- Model name **configurable** via `OLLAMA_MODEL` (default `qwen3.5:9b-q4_K_M`), because model names change.
- Prompt uses a system message including: current date, role of the user, today's KPI snapshot (small JSON), and tool descriptions — the "grounding" makes answers accurate.

## 7. UX / UI plan (skill files to follow: design-taste-frontend + impeccable + emil-design-eng)

- Design language: "billing-grade SaaS" — calm, precise, pro-tool feel like Linear/Stripe not cottage template. Dark-first palette (design tokens in `globals.css`), single accent (indigo→violet ramp), 8px spacing scale, Inter or Geist typeface, tabular-nums everywhere money shows.
- Admin console: sidebar nav + topbar (search/⌘K palette + copilot launch). Key screens exist as table views w/ column sort, filter chips, row actions. Subscription pipeline shown as **board/columns** (Draft → Quotation → Confirmed → Active → Closed) with dragless click-move.
- Billing-day "run" button animates an invoice-count ticker (PS scene "billing day").
- Customer portal: card-based, clear "what you owe / next bill" hero + subscription cards (pause/renew/cancel buttons honoring plan flags).
- Landing page: real marketing page w/ pricing cards built from actual plans API.
- **Every page sub-2s**: server aggregates in SQL, TanStack Query caching, virtualized big tables (TanStack Virtual) if >200 rows, `loading.tsx` skeletons.

## 8. Acceptance checklist derived from ps.pdf scenes (map to tasks in §10)

- [ ] Signup: unique email; password >8 chars + upper + lower + special; forgot → reset link (dev mailbox). Invalid email inline error.
- [ ] Roles: admin (full), staff (limited: no discounts/staff/products structural changes? — staff can do customer work, billing, quotes; admin-only for staff creation, discount rules, product/plan CRUD, tax rules), customer (only own subscriptions + invoices + demo payment).
- [ ] Admin adds product with name/type/sales/cost/notes + variants (brand variant "Odoo" → +560 price).
- [ ] Plans: interval d/w/m/y, min qty, valid dates, auto_close / allow_pause / allow_early_cancel / auto_renew toggles.
- [ ] Quote template with valid_days + prefilled lines; creating subscription from template (Draft → Quotation (sent) → Confirmed → Active → Closed) with per-sub number, customer, start/expiry, payment terms, lines w/ product qty unit price taxes amount.
- [ ] Billing day: generate invoices for all due subscriptions in one click; auto taxes; confirm/cancel/send/print; no double billing (unique constraint) & none skipped (idempotent run loop).
- [ ] Discounts: only admin creates (fixed | %, min purchase, min qty, dates, max uses, product scope or subscription scope). Applies to next invoice as separate line. Stops after expiry/max uses.
- [ ] Payments: method, amount, date, note, linked invoice; outstanding vs paid view; partial payments; overdue tracking.
- [ ] Finance dashboard: active subs count, revenue, outstanding, overdue; filters + series charts; sub-2s with thousands rows.
- [ ] AI: chat with tools for all 3 roles + file bulk-add.

## 9. Non-negotiable standards (Expectations.txt alignment)

- No BaaS; Postgres local; vanilla SQL available; API first; server-side validation everywhere (Zod schemas per route in `routes/*.validation.ts`); graceful error feedback in UI (toast + inline field errors + disable submit until valid).
- Git per §1 rotations, conventional commits.
- Every feature branch merged with `--no-ff` keeps author variety.
- README at root: setup, demo accounts, ER diagram (generated from drizzle), API list, screenshots.
- Seed data must make dashboards demo-worthy the FIRST run (hundreds of subs, invoices, variety of statuses, some overdue) via `npm run seed` idempotently.

## 10. Work breakdown (T-shape: total build order)

Phase A — Foundations: scaffold monorepo, environment, db migration base, auth+roles+sessions complete (Alwin + Sanay).
Phase B — Catalog & rules: products (variants) + taxes + discounts CRUD + staff mgmt (Sanay + Ullas).
Phase C — Quotes & subscriptions: templates, lifecycle FSM, renewals/pause, portals (Sanay).
Phase D — Billing: pricing calc (lines+taxes+discounts), billing run idempotency, invoices, print view, payments (Sanay + Alwin).
Phase E — Reports: KPI + series + overdue (Ullas).
Phase F — AI: Ollama client, tool registry, chat UI, bulk import hybrid parser+wizard (Johnu + Sanay review).
Phase G — Design sweep: global design system + anim polish w/ skills (whole team/self).
Phase H — Demo prep: seed, README/ER diagram, final QA (skills break-ui + impeccable passes).

## 11. Environment / How to run (summary; full in PROGRESS.md)

```
# DB
psql -U postgres -c "CREATE DATABASE brightloop;"        # password 'root' when prompted
# API
cd apps/api && npm i && npx drizzle-kit push && npm run seed && npm run dev   # :4000
# Web
cd apps/web && npm i && npm run dev                        # :3000
```
`.env` apps/api: DATABASE_URL/PORT/CORS_ORIGIN/SESSION_SECRET(use random at first boot or env)/OLLAMA_URL/OLLAMA_MODEL/COOKIE_SECRET.
`.env` apps/web: NEXT_PUBLIC_API_URL=http://localhost:4000.

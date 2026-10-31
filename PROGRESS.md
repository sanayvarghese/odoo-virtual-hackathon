# Brightloop — PROGRESS tracker

> Update the task board + "session log" at the END of every work session.
> A new agent reads `PLAN.md` (architecture & conventions) then this file (what's done / what's next) and can continue seamlessly.

## How to run the project (current truth)

```bash
# 1. Postgres must be running locally (user: postgres, password: root, port 5432)
#    Database name: brightloop
# 2. API
cd apps/api
npm install
npm run db:push      # drizzle-kit push (creates/updates tables)
npm run db:migrate   # applies extra SQL from src/db/views.sql (views, indexes)
npm run seed         # idempotent demo data (Brightloop)
npm run dev          # http://localhost:4000  (swagger docs at /docs)
# 3. Web
cd apps/web
npm install
npm run dev          # http://localhost:3000
# 4. Ollama must be running with model: ollama pull qwen3.5:9b-q4_K_M (configurable via OLLAMA_MODEL)
```

Demo accounts (created by seed; passwords all `Bright@2025` unless changed):
- admin@brightloop.dev (admin)
- staff@brightloop.dev (staff)
- customer@brightloop.dev (customer, "Sunrise Retail")
- customer2@brightloop.dev (customer, "Acme Traders")

## Task board

Legend: [ ] todo · [~] in progress · [x] done · [-] skipped/won't do · [!] blocked, note blocker

### Phase A — Foundations
- [ ] Monorepo scaffold (npm workspaces, apps/api, apps/web, tsconfigs, .env, .gitignore)
- [ ] API skeleton: Fastify app, env validation, error handler, swagger, health route
- [ ] DB: drizzle schema (all tables in PLAN §4), db:push + views/dashboard SQL migrations
- [ ] Auth: register/login/logout/me, argon2, session cookies (httpOnly+SameSite), CSRF, rate limits
- [ ] Password policy + validation steps of ps.pdf (unique email, >8 chars, upper/lower/special)
- [ ] Forgot/reset via dev mailbox tokens
- [ ] Roles/RBAC plugin (requireRole) + demo seed with 4 accounts

### Phase B — Catalog & rules
- [ ] Products CRUD + variants (+560 Odoo-brand example) — admin only
- [ ] Product bulk import (AI path in Phase F; plain mapper now)
- [ ] Tax rules CRUD; Discounts CRUD + usage counters & scopes — admin only
- [ ] Staff management (admin only adds staff)

### Phase C — Quotes & subscriptions
- [ ] Quotation templates + lines (valid_days)
- [ ] Subscriptions: create from template/scratch (draft), send→quotation, confirm, activate, renew, pause/resume, cancel, close (FSM, illegal transitions 409)
- [ ] Subscription numbering SUB-YYYY-NNNNN via numberings table
- [ ] Customer portal pages: my subscriptions w/ plan-flag-gated actions

### Phase D — Billing
- [ ] Billing service: due-date computation per interval & min_qty, pass & skip nothing, no double billing (unique(subscription_id, period))
- [ ] POST /billing/run (admin): creates N draft invoices in one tx, returns counts
- [ ] Tax + discount application at confirm time (snapshot into invoice lines)
- [ ] Invoice numbering INV-YYYY-NNNNNN, invoice statuses, send/print (print view), cancel
- [ ] Payments: record w/ method/amount/date/note, partials, paid/outstanding states
- [ ] Customer portal pay-now (mock checkout, server-validated) + invoice cards

### Phase E — Reports
- [ ] /reports/summary + /reports/series (revenue, MRR, overdue) role-scoped
- [ ] SQL views: v_mrr_monthly, v_outstanding, v_revenue_monthly
- [ ] Admin dashboard UI: KPI cards, filters, charts (Recharts), overdue table (Ullas)

### Phase F — AI copilot (Johnu)
- [ ] Ollama client (OpenAI-compat, streaming, tools, OLLAMA_MODEL env)
- [ ] Tool registry with role checks (kpi/list/find scoped helpers)
- [ ] /ai/chat SSE endpoint + chat UI (drawer, markdown-lite, tool_result chips)
- [ ] /ai/import hybrid parser (xlsx local parse → LLM header map on 5 sample rows → deterministic map → zod validate → optional soft-repass LLM on bad rows → preview)
- [ ] Preview grid UI + commit endpoint (transactional chunk batch insert) + ai_import_jobs audit
- [ ] Customer assistant tools + sales quote-draft tool

### Phase G — Design sweep (skills: design-taste-frontend, impeccable, emil-design-eng)
- [ ] Design tokens (dark-first, accent ramp, spacing scale, typography, tabular-nums)
- [ ] Component library (Button/Input/Card/Table/Badge/Modal/Drawer/Toast/Tabs/KPI/EmptyState/Skeleton)
- [ ] Landing page, auth pages, admin shell (sidebar+topbar+⌘K), portal shell
- [ ] Pipeline board for subscriptions, invoice print view, billing-run animation
- [ ] Mobile-nav + responsive passes (skill: mobile-native rules for touch)

### Phase H — Demo prep
- [ ] README (setup, demo accounts, ER diagram, API list)
- [ ] break-ui stress test pass (long names, 0 items, huge numbers, emoji)
- [ ] impeccable polish pass + animation audit
- [ ] Commit/push all branches w/ rotated authors (see §1 of PLAN.md)

## Session log (newest first)

### Session 1 — [date: 2026-10-31]
- Read ps.pdf (extracted to ps.txt) + Expectations.txt. Agreed plan (see PLAN.md).
- Wrote PLAN.md and PROGRESS.md (this file).
- NEXT UP: Phase A scaffold — root package.json workspaces, apps/api Fastify skeleton, drizzle schema, auth module.

## Gotchas / decisions log (-append emerging facts here so next agent doesn't trip)
- Postgres installed locally, credentials postgres/root @5432. `psql` NOT in bash PATH; use Node `pg` for everything (drizzle-kit push uses its own driver, fine).
- Use `git-switch switch <name>` before each commit to rotate authors (Sanay ≈ 40-45%).

## Deferred / nice-to-have
- Email attachments/invoice PDF via real pdf lib (print-view @media print is enough for demo)
- Real payments gateway (explicitly out of scope; mock checkout + console explanation)
- Test suites (a few vitest contract tests are a plus if time remains)

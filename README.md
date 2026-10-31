# Brightloop — Subscription Management System

Plans, subscriptions and recurring billing in one auditable place — with an AI copilot that runs entirely on your own machine. Built for the Odoo virtual hackathon.

```
┌─────────────────────────────┐        ┌──────────────────────────────┐
│  apps/web  (Next.js 15)     │  HTTP  │  apps/api  (Fastify 5 + TS)  │
│  :3000                      │◄──────►│  :4000  (/docs for Swagger)  │
│  React 19 · TanStack Query  │ cookies│  argon2 · sessions · CSRF    │
│  Tailwind v4 · Geist        │ + CSRF │  drizzle → PostgreSQL        │
└─────────────────────────────┘        └───────────────┬──────────────┘
                                        │               │
                                 ┌───────▼──────┐  ┌─────▼─────────────┐
                                 │ Ollama :11434│  │ PostgreSQL :5432  │
                                 │ qwen3.5 9B   │  │ db: brightloop    │
                                 │ (local only) │  │ + SQL views       │
                                 └──────────────┘  └───────────────────┘
```

## Run it

Prerequisites: Node 22+, PostgreSQL (user `postgres`, password `root`, port 5432), and [Ollama](https://ollama.com) with the model pulled.

```bash
# 1. Database (creates db if missing)
npm run db:create
npm run db:push -w apps/api        # drizzle schema
npm run db:views -w apps/api       # reporting views (v_mrr, v_outstanding, ...)
npm run seed -w apps/api           # demo workspace (seed:fresh wipes first)

# 2. Ollama model (one time)
ollama pull qwen3.5:9b-q4_K_M

# 3. Both apps (separate terminals)
npm run dev -w apps/api            # API on http://localhost:4000 (/docs = Swagger)
npm run dev -w apps/web            # Web on http://localhost:3000
```

## Demo accounts — password `Bright@2025`

| Role     | Email                     | Sees                                            |
| -------- | ------------------------- | ----------------------------------------------- |
| Admin    | `admin@brightloop.dev`    | Everything, incl. staff, taxes, billing runs     |
| Staff    | `staff@brightloop.dev`    | Daily operations, no staff/tax admin            |
| Customer | `customer@brightloop.dev` | Their own portal: subscriptions, invoices, plans |

Emails (verification, password reset, staff invites) are **real when SMTP is configured** — see `apps/api/.env.example` for the Gmail / Brevo recipe (Nodemailer over SMTP, env-gated). Without SMTP they land in the **dev mailbox** at `/mailbox`.

## What to demo (the 5 scenes of the problem statement, mapped)

1. **Plans & catalogue** — `/products` (variants: the Odoo brand adds ₹560), `/plans` (interval, min qty, validity dates, per-plan pause/cancel/renew/auto-close flags). Bulk import: paste rows or upload `.xlsx/.csv` → local mapping → preview grid → commit only valid rows.
2. **Quotes → subscriptions** — `/subscriptions`: create a draft, send as quotation, confirm, activate. Illegal transitions are rejected by the FSM (409) with a readable message.
3. **Recurring billing** — Plans page → **Run billing**: drafts every invoice due today in one transaction; `(subscription_id, period_start)` unique key makes double billing impossible (rerun reports `created: 0, skipped: N`).
4. **Invoices & payments** — tax + discounts snapshot at confirm time (GST 18/12/0%, `WELCOME10`, `SEATS15`), invoice print view, payments with partials; the customer portal has a mock pay-now checkout.
5. **AI copilot** — floating dock on every screen: SSE streaming from local Ollama, role-scoped tools (KPIs, overdue invoices, plan advice, customer lookup). Staff can attach a spreadsheet and bulk-import from the chat.

## API surface (`/api/v1`, Swagger at `/docs`)

- `auth` — register, login, logout, me, csrf, forgot/reset, verify, email-available
- `products` + `products/:id/variants` — catalogue CRUD (admin writes, staff read)
- `plans` — CRUD with lifecycle flags; `?availableOnly=true` for the portal
- `taxes`, `discounts` (+ `/validate`, `/:id/usages`), `templates` — quote templates
- `subscriptions` — list/get/create, `/transition`, line replace (draft only), discounts, `/bill`, `/events` timeline
- `billing/run` — the idempotent pass
- `invoices` — list/get, `/confirm`, `/send`, `/cancel`, `/next/for-subscription/:id`
- `payments` — record (partials ok), list, `/overdue`
- `reports/summary`, `reports/series?metric=revenue|mrr|subscriptions`
- `ai/health`, `ai/chat` (SSE), `ai/import?entity=product|plan|customer`, `ai/import/:jobId` (+ `/commit`)
- `dev/mailbox`, `dev/config` — demo utilities

## Engineering notes

- **Money is integer cents everywhere**; percents are stored ×100 (1800 = 18%) and applied as ÷10000. No floats touch a rupee.
- **Auth**: argon2id password hashing, opaque session token (sha256 at rest) in an httpOnly `SameSite=Lax` cookie, double-submit CSRF (`bl_csrf` + `X-CSRF-Token`), rate limits on auth routes. RBAC: `requireRole('admin'|'staff')` server-side on every privileged route.
- **AI**: native Ollama `/api/chat` with tool calling and `think:false` (fast streaming); the importer only lets the model *repair* formatting of rows that failed validation — it may never invent a value that was not in the source. Staged in `ai_import_jobs` with an audit trail; commit is transactional.
- **Frontend**: Next.js App Router, TanStack Query, Tailwind v4 tokens. Design system: "achromatic ledger" — ink chrome, one hue (`#1d5fbf`) on the main data element, Geist + Geist Mono for record IDs, 44px ledger rows.

## Repo layout

```
apps/api   Fastify API — routes/ services/ db/ seed/
apps/web   Next.js frontend — src/app (routes) src/components src/lib
PLAN.md    architecture & conventions · PROGRESS.md task board & session log
```

© 2026 — team Brightloop (Sanay, Alwin, Johnu, Ullas).

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
- [x] Monorepo scaffold (npm workspaces, apps/api, apps/web, tsconfigs, .env, .gitignore)
- [x] API skeleton: Fastify app, env validation, error handler, swagger, health route
- [x] DB: drizzle schema (all tables in PLAN §4), db:push + views/dashboard SQL migrations
- [x] Auth: register/login/logout/me, argon2, session cookies (httpOnly+SameSite), CSRF, rate limits
- [x] Password policy + validation steps of ps.pdf (unique email, >8 chars, upper/lower/special)
- [x] Forgot/reset via dev mailbox tokens
- [x] Roles/RBAC plugin (requireRole) + demo seed with 4 accounts

### Phase B — Catalog & rules
- [x] Products CRUD + variants (+560 Odoo-brand example) — admin only
- [~] Product bulk import (AI path in Phase F; plain mapper now)
- [x] Tax rules CRUD; Discounts CRUD + usage counters & scopes — admin only
- [x] Staff management (admin only adds staff)

### Phase C — Quotes & subscriptions
- [x] Quotation templates + lines (valid_days)
- [x] Subscriptions: create from template/scratch (draft), send→quotation, confirm, activate, renew, pause/resume, cancel, close (FSM, illegal transitions 409)
- [x] Subscription numbering SUB-YYYY-NNNNN via numberings table
- [ ] Customer portal pages: my subscriptions w/ plan-flag-gated actions

### Phase D — Billing
- [x] Billing service: due-date computation per interval & min_qty, pass & skip nothing, no double billing (unique(subscription_id, period))
- [x] POST /billing/run (admin): creates N draft invoices in one tx, returns counts
- [x] Tax + discount application at confirm time (snapshot into invoice lines)
- [x] Invoice numbering INV-YYYY-NNNNNN, invoice statuses, send/print (print view), cancel
- [x] Payments: record w/ method/amount/date/note, partials, paid/outstanding states
- [ ] Customer portal pay-now (mock checkout, server-validated) + invoice cards

### Phase E — Reports
- [x] /reports/summary + /reports/series (revenue, MRR, overdue) role-scoped
- [x] SQL views: v_mrr, v_outstanding, v_revenue_monthly, v_overdue
- [~] Admin dashboard UI: KPI bands, charts (own SVG), outstanding table (Ullas)

### Phase F — AI copilot (Johnu)
- [x] Ollama client (native /api/chat, streaming, tools, OLLAMA_MODEL env)
- [x] Tool registry with role checks (kpi/list/find scoped helpers)
- [~] /ai/chat SSE endpoint + chat UI (drawer, markdown-lite, tool_result chips)
- [x] /ai/import hybrid parser (xlsx local parse → LLM header map on 5 sample rows → deterministic map → zod validate → optional soft-repass LLM on bad rows → preview)
- [ ] Preview grid UI + commit endpoint wiring (preview grid UI pending) + ai_import_jobs audit
- [~] Customer assistant tools + sales quote-draft tool

### Phase G — Design sweep (skills: design-taste-frontend, impeccable, emil-design-eng)
- [x] Design tokens: "Achromatic ledger" direction dealt via skill (ink chrome, one hue #1d5fbf, Geist + Geist Mono, white cards on #f2f4f7 ground)
- [x] Component library (Button/Input/Card/Table/Badge/Modal/Toast/Tabs/KPI/EmptyState/LineChart)
- [x] Landing page (loop motif, live fragments), auth pages, admin shell (sidebar + phone fold sheet), portal shell
- [x] Pipeline board for subscriptions, invoice print view, billing-run action (console + landing fragment)
- [~] Mobile-responsive passes: shell fold + landing done; table screens scroll horizontally (acceptable for demo)

### Phase H — Demo prep
- [x] README (setup, demo accounts, scene→screen map, API list, engineering notes)
- [~] break-ui stress test pass (long names, 0 items, huge numbers, emoji)
- [ ] impeccable polish pass + animation audit
- [x] Commit/push all w/ rotated authors (see §1 of PLAN.md)

## Session log (newest first)

### Session 2 — 2026-10-31 (frontend build-out)
- Dealt app art direction with design-taste-frontend `draw.mjs --app --kind finance` → chose **Achromatic ledger**: ink chrome (no brand colour), white cards on #f2f4f7 ground, one chart hue #1d5fbf on the main data element, Geist + Geist Mono (mono for IDs), radii 8/6, 44px table rows. Tokens live in `apps/web/src/app/globals.css` (@theme).
- Scaffolded `apps/web` (Next 15, React 19, Tailwind v4, TanStack Query). API client auto-attaches X-CSRF-Token from bl_csrf cookie; errors map to ApiError (server envelope `{error:{message,code}}`).
- Built: app shell (open-plane sidebar 256px, no top bar), floating AI copilot dock (SSE via next.config rewrite /api/ai/chat → :4000), LineChart component per direction rules (straight ink line, dashed hover guide, tabular-nums).
- Auth cluster (Alwin): /login (demo-account one-click fill), /signup (live email-available check + password policy ticks), forgot/reset/verify, /mailbox dev mailbox reader.
- Dashboard + Reports (Ullas): KPI band (MRR/cash/outstanding/overdue), revenue line chart, outstanding-invoices table, pipeline counts; Reports page with metric tabs (cash / MRR by interval bars / pipeline counts).
- Completed console + portal surfaces: products CRUD/search/pagination + safe bulk-import preview/commit; plans with lifecycle flags and safe billing run; six-state subscription board + detail/timeline; invoices/print/payment capture; customer directory, staff management, taxes/discounts; customer self-service portal (plan-gated actions and mock checkout).
- **Landing page rebuilt from scratch (Alwin)**: the first version rendered with mojibake (cp1252 write) and thin composition — rewritten fully via the write tool: lifecycle-loop motif (rings + 6 state nodes turning with scroll), five real `data-ui` interface fragments as imagery (live subscription card, billing-run result with seeded counts 4/3/1/0, six-state lifecycle slider, paste→preview import panes, seeded-plan pricing index), FAQ tiles, DEMO CTA band. Gates: `lint.mjs` 0 FAIL, `inspect.mjs` **0 FAIL** (fixed: hero 3-line headline → stacked layout + clamp; mono→`<code>`; contrast #b6bac1→#6d727b and .lp a specificity bug; still-page → JS-armed IntersectionObserver reveals + scroll-rotating ring; phone nav padding; node collisions on mobile). Root cause lesson: headless Chrome on this machine reports `prefers-reduced-motion: reduce` — motion must not be gated behind `no-preference` media (reduced page = finished page); arm hidden states via JS instead.
- Filled functional gaps: new-subscription dialog on the pipeline (verified POST → SUB-2026-000013 draft), phone fold for console/portal shell (48px top bar + full-screen sheet), read-only settings page (identity, security posture, local runtime).
- README.md written (setup, demo accounts, scene→screen map, API list, engineering notes).
- Commits: sanay×3 (scaffold, dashboard typo-fix…) alwin×1 (auth) — pushed to origin/main.
- Commits: sanay×3 (scaffold, dashboard typo-fix…) alwin×1 (auth) — pushed to origin/main.

### Session 1 — [date: 2026-10-31]
- Read ps.pdf (extracted to ps.txt) + Expectations.txt. Agreed plan (see PLAN.md).
- Wrote PLAN.md and PROGRESS.md (this file).
- NEXT UP: Phase A scaffold — root package.json workspaces, apps/api Fastify skeleton, drizzle schema, auth module.

## Gotchas / decisions log (-append emerging facts here so next agent doesn't trip)
- Postgres installed locally, credentials postgres/root @5432. `psql` NOT in bash PATH; use Node `pg` for everything (drizzle-kit push uses its own driver, fine).
- Use `git-switch switch <name>` before each commit to rotate authors (Sanay ≈ 40-45%).
- Report routes are under prefix `/api/v1/reports` (NOT /report). Money = integer cents; percent fields = value*100.
- /reports/summary `revenueSeries[].month` is a full ISO timestamp — slice(0,7) for month labels. outstandingList ids come back as strings.
- Next rewrites proxy only `/api/ai/chat` → API (SSE). All other fetches go direct to http://localhost:4000/api/v1 with credentials:include.
- Tailwind v4 tokens declared in globals.css @theme (colors: ground, surface, line, rule, ink, muted, faint, ledger(#1d5fbf), positive/negative/warning + tints). Money class = bold + tabular-nums; IDs use font-mono.
- Auth links point at web :3000 (APP_URL): /verify?token=… and /reset-password?token=… (page group (auth)).
- git-switch switch sanay|alwin|johnu|ullas rotates git + gh; push once per milestone (origin/main).

## Deferred / nice-to-have
- Email attachments/invoice PDF via real pdf lib (print-view @media print is enough for demo)
- Real payments gateway (explicitly out of scope; mock checkout + console explanation)
- Test suites (a few vitest contract tests are a plus if time remains)

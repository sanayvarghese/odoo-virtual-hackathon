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
- Bug round (user-reported, all fixed + verified):
  - Dev mailbox/config 404: the dev module had a doubled prefix (`/api/v1/dev` + `/dev/mailbox`). Routes renamed to `/mailbox`, `/config`, `/gate`.
  - "Could not load subscriptions" (admin pipeline): the page requested `limit=300` but the API caps at 100 → validation error. Now 100.
  - Copilot "could not be reached": the dock always sent multipart FormData, but the SSE `/chat` route parses JSON only. Now chat = JSON (verified streaming through the :3000 rewrite); attached files go to `/ai/import` with an entity picker (product/plan/customer) and stage a job for review — nothing commits from the dock.
  - Landing: removed the interactive off-states (toggles left blank/invisible bands); statements are always readable with loop bullets; scroll reveals have a 2.5s failsafe so nothing can stay hidden.
  - Customer self-subscribe: new `POST /subscriptions/self` (customer-scoped) — portal Browse plans → Subscribe dialog → draft lands on the staff pipeline (verified: SUB-2026-000014 draft, Sunrise Retail). Portal cards now show plan descriptions (seeded) and draft/quotation states explain "waiting for our team".
  - Plan descriptions added to seed (and UPDATEd into the live DB non-destructively).
- Second bug round (user-reported, all fixed):
  - **Copilot answered nothing ("I did not get an answer…")**: the SSE frames are `event: <name>` + `data: {"t":…}` — the parser read a `type` field that doesn't exist. Rewrote the parser to track the event line; chat verified streaming again. Attachments in the dock now go to `/ai/import` with an entity picker.
  - **New landing built from scratch** (user rejected the orb hero: scroll misalignment): calm editorial layout — dark hero + a REAL overview fragment (KPIs/chart/invoice rows), six-state stepper (no orbs), LIVE plan catalogue from new public endpoint `GET /plans/public` (no auth, marketing fields only), subscribe → `/login?next=/portal/plans?subscribe=<id>` → auto-opens the checkout dialog, billing math cards, AI/import section, FAQ (credentials REMOVED from the page), CTA band. No scroll-linked transforms (the misalignment cause); motion = JS inline-style reveals (works even when the OS forces prefers-reduced-motion, which headless Chrome here does).
  - Login/signup now auto-redirect when already signed in; shell redirects carry `?next=`.
  - Settings is editable: display name (new `PATCH /auth/me`) and customer billing profile (existing ownership-checked PATCH).
  - Taxes & discounts overflow fixed (stacking + table scroll wrappers).
  - Admin can promote a customer to staff: new `POST /staff/:id/promote` + UI in Staff (verified: customer2 promoted → staff).
  - Reports had "no graphs": the seed's payments sat in one month. Seed now spreads payments and adds 10 backdated settled invoices across 5 months → 6 months of revenue series (verified). `seed:fresh` regenerates it.
  - globals.css: ≤720px grids fall to 2-up; `.card` gets overflow-x for wide tables.
  - `testfileupload.txt` at repo root: 8 product rows (with messy shapes) for upload demos in the copilot/import wizard.
- Third round (user asks): **functional chat** — staged imports now render as a real table inside the chat with a working **Commit** button (commits, toasts, then navigates to Products/Plans/Customers); pasted tables in the chat are detected and staged (entity picker next to the input); new `go_to_page` client tool + typed intents ("open invoices" navigates, "commit" commits) handled locally with zero model round-trip; answers render markdown tables and **bold**; system prompt instructs markdown-table output. Import parser now locates the header row inside files with prose preambles (testfileupload.txt verified: 8/8 staged, commit inserted 8, then rows cleaned for a fresh demo).
- **SMTP integration (user uses Gmail)**: nodemailer + env-gated `lib/mailer.ts` (SMTP_HOST/PORT/USER/PASS/MAIL_FROM — Gmail app password on :465 or Brevo :587, both documented in `apps/api/.env.example`). When set, verification/reset/invite emails go to the real inbox AND the dev mailbox copy; when unset, dev mailbox only. `/dev/config` now exposes `mailMode`.
- Fourth round (user asks): product DELETE is now a **real delete** (was soft-disable). FK map: variants cascade, invoice_lines set-null (history safe), plans/subscription_lines restrict → the API returns a readable 409 ("delete or retire those first") by mapping the pg integrity class (`23xxx`) through the cause chain — drizzle wraps driver errors as DrizzleQueryError. Also fixed a demo-blocker: the web form said "SKU optional" but the API required it — the API now auto-generates a unique SKU from the name when blank. Demo data cleaned: `seed:fresh` removes all chat-imported test products and stray test subscriptions; the catalogue holds only the 5 meaningful seed products; customer2 is back to customer. SCRIPT.md added (full demo script + 4-min short cut + fallbacks).
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

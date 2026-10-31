# SCRIPT.md — Brightloop demo script (~10 min, short cut ~4 min)

The literal lines to type into the **AI copilot** are in quotes. Everything else is clicking.

---

## 0. Pre-demo checklist (do 10 minutes before)

- [ ] Postgres running → `npm run seed:fresh -w apps/api` (fresh demo month + 6-month chart history)
- [ ] API on :4000 → `npm run dev -w apps/api` (health: `curl localhost:4000/api/v1/health`)
- [ ] Web on :3000 → `npm run dev -w apps/web`
- [ ] Ollama up with the model → `ollama run qwen3.5:9b-q4_K_M "hi"` once to warm it (first token after idle is slow)
- [ ] Optional: SMTP in `apps/api/.env` (Gmail app password) if you want the forgot-password email to hit a real inbox
- [ ] Browser tabs pre-opened: home `/`, `/login`, `/mailbox`; phone emulator (F12 → 390px) for one shot
- [ ] `testfileupload.txt` ready to upload from the copilot dock

---

## 1. The pitch (30 s) — landing page

Show the hero: "This is Brightloop — plans, subscriptions, recurring billing in one auditable workspace. Everything you'll see runs on localhost: Postgres, Fastify, Next.js, and the AI is a local Ollama model. No cloud, no keys."

Click **See the plans** → the plan cards are **live from the admin's catalogue** (point at it): "This is not a static page — it reads `GET /plans/public`, the same data the admin manages."

Pick any plan → **Subscribe** → it lands on login with `?next=` → after sign-in the checkout dialog opens by itself. Sign in as `customer@brightloop.dev / Bright@2025`. Leave quantity 3, add note "Support team", press **Request subscription**.

> Say: "Customers self-serve — but nobody's money moves: the request is a DRAFT on the staff pipeline. The FSM decides everything."

---

## 2. Admin console — the overview (1 min)

Sign out → sign in as `admin@brightloop.dev`.

The dashboard: MRR / Collected / Outstanding / Overdue band (hover **MRR** — tooltip), 6 months of collected revenue from real payments, the outstanding chase list, pipeline counts.

**AI prompt:** `"What are this month's KPIs?"`
→ Streams a short answer with real figures, **bold** totals.

---

## 3. Products + AI bulk import (2 min) — the wow scene

Go to **Products** → point at the seed catalogue and the Odoo variant (+₹560 — say: "the problem statement's example: choosing the Odoo brand adds 560, the plan price follows").

Open the copilot dock, press 📎, upload **testfileupload.txt**, pick "products":

> "Import this file"

→ The staged table appears **in the chat** — 8 rows, all ✓ valid, with a **Commit 8 products** button.

Press **Commit** → toast → the app navigates itself to the Products page → scroll: the 8 new products are in the catalogue.

> Say: "The copilot mapped the headers locally, validated every row, showed exactly what would be written — and only wrote it when I pressed commit. The model is allowed to fix formatting, never to invent a value. And typing just 'commit' would have done the same."

Then: `"open invoices"` → the app navigates (client-side tool).

---

## 4. Subscriptions lifecycle (2 min)

Open **Subscriptions** — the pipeline board: Draft → Quotation → Confirmed → Active → Paused/Closed.

**AI prompt:** `"Draft a quotation for Sunrise Retail on Brightloop CRM for 5 seats"`
→ The `draft_quote` tool really creates one. Click the new SUB in the Draft column.

Walk the FSM: **Send as quotation** → **Confirm** → **Activate**. At each step the event timeline records it.

> Say: "Six states, and the server rejects any shortcut — try skipping one and you get a 409 with a readable message."

Point at the plan rules strip: pause/cancel/renew flags come **from the plan**.

---

## 5. Billing run — the idempotency shot (1.5 min)

**Plans → Run billing.** Toast: "N invoices created".

Press it again immediately: "0 created, skipped N".

> Say: "One pass drafts every invoice due today in a single transaction. The key is subscription + period — double billing is structurally impossible, not just discouraged. Nobody types invoices by hand."

---

## 6. Invoices, tax, payments (1.5 min)

Open **Invoices** → pick the overdue one (red "d overdue").

Open it: lines with **GST 18%** and **WELCOME10 −10%** snapshotted at confirm time. Press **Print / save as PDF** (a clean print view).

Back → **Record payment**: part-payment ₹5,000 → status flips to `partially_paid`, balance updates. Then settle the rest → `paid`.

> Say: "Tax and discounts froze at confirm — editing the rule later never rewrites issued history."

---

## 7. Reports (30 s)

**Reports** → tabs: Cash collected (line chart, 6 months), MRR by interval (bars), Pipeline. Hover a point → the tooltip shows the real month figure.

**AI prompt:** `"Show me overdue invoices as a table"`
→ A markdown table in the chat.

---

## 8. Customer portal + plan rules (1.5 min)

Sign out → sign in as `customer@brightloop.dev`.

Portal → **My subscriptions**: the draft from scene 1 says *"Requested — waiting for our team to confirm."* An active one shows **Pause / Cancel** — but only because its plan allows it.

> Say: "The portal reads the plan flags before showing an action, and the server enforces them again. A yearly Suite plan would show no pause button at all."

**Invoices & payments** → **Pay now** on an unpaid invoice → mock checkout (full or part) → paid.

**Browse plans** → shows live catalogue with descriptions → Subscribe → another request lands on the staff pipeline.

---

## 9. Security + real email (1 min)

- **Forgot password** (from the login page) → with SMTP configured the link lands in the **real Gmail inbox**; open it → reset form with the live password policy. Without SMTP the same link is in the **dev mailbox**.
- **Wrong role**: as customer, try opening `/staff` → blocked. The API returns 403s the same way — every check is server-side.
- Mention: argon2id passwords, httpOnly session cookies, double-submit CSRF on every mutating call.

---

## 10. Closing line

"Everything in the problem statement is implemented — plans with per-plan rules, the six-state lifecycle, idempotent recurring billing, tax snapshots, partial payments, a customer portal, and a local AI copilot that doesn't just talk: it imports, commits and navigates. Fully local, fully auditable."

---

## Short cut (~4 min)

1. Landing → subscribe a plan as customer (30 s)
2. Admin: copilot import `testfileupload.txt` → **Commit** (60 s)
3. `"Draft a quotation for Sunrise Retail on Brightloop CRM for 5 seats"` → walk FSM to Active (60 s)
4. Run billing **twice** → "0 created, skipped N" (30 s)
5. `"Show me overdue invoices as a table"` → pay one partially from the portal (40 s)

## If something fails on stage

- Copilot slow first answer → it's the model waking from idle; ask again, later answers stream in ~1-2 s.
- "Could not map required columns" → the file has no recognizable header; paste a header row like `sku, name, kind, sales price`.
- Billing run says created=0 → everything already billed — that IS the idempotency demo; say it.
- API down → `npm run dev -w apps/api`; web down → `npm run dev -w apps/web` (never run `next build` while the dev server is up).

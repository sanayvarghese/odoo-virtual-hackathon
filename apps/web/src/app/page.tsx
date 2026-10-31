"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { LoopMark } from "@/components/app-shell";
import "./landing.css";

/**
 * Brightloop public page — "one motif" direction: the subscription lifecycle
 * loop is the page's single shape. Every figure on it comes from the seeded
 * demo workspace; interface fragments (data-ui) are the page's imagery.
 */

const STATES = [
  {
    id: "draft",
    name: "Draft",
    clause: "It starts as a draft.",
    copy: "Built from a plan, a product and a quantity. Nothing bills until someone moves it.",
    next: "—",
    event: "Created from Brightloop CRM Monthly",
    actions: ["Send as quotation", "Discard"],
  },
  {
    id: "quotation",
    name: "Quotation",
    clause: "Sent as a quotation.",
    copy: "An accountable offer the customer can read, still editable until it is confirmed.",
    next: "—",
    event: "Quotation SUB-2026-000001 sent to Sunrise Retail",
    actions: ["Confirm", "Cancel"],
  },
  {
    id: "confirmed",
    name: "Confirmed",
    clause: "Confirmed locks the deal.",
    copy: "GST and discounts snapshot into the invoice at confirm time. History is never rewritten.",
    next: "1 Nov 2026",
    event: "Taxes frozen: GST 18 percent, WELCOME10 applied",
    actions: ["Activate"],
  },
  {
    id: "active",
    name: "Active",
    clause: "Billed once per period.",
    copy: "The (subscription, period) key makes double billing impossible. Reruns skip what exists.",
    next: "26 Nov 2026",
    event: "Invoice INV-2026-000001 paid ₹26,539.38",
    actions: ["Pause", "Renew", "Close"],
  },
  {
    id: "paused",
    name: "Paused",
    clause: "Paused, not lost.",
    copy: "Only where the plan allows it: the flag on the plan decides, not the mood of the day.",
    next: "held",
    event: "Billing held; history and MRR stay intact",
    actions: ["Resume", "Close"],
  },
  {
    id: "closed",
    name: "Closed",
    clause: "Closed ends the loop.",
    copy: "At expiry by rule, or early with a reason. Every step lands in the event timeline.",
    next: "—",
    event: "Closed at period end · final invoice archived",
    actions: [],
  },
];

const FEATURES = [
  {
    on: "Nobody types invoices by hand.",
    off: "Typing invoices by hand, then.",
    consequence: "One billing pass found every subscription due today and drafted their invoices in a single transaction.",
  },
  {
    on: "Plans set the rules.",
    off: "Rules nobody set.",
    consequence: "Pause, early cancel, auto-renew and auto-close live on each plan. The portal reads the flags before showing an action.",
  },
  {
    on: "Tax freezes at confirm.",
    off: "Tax that rewrote itself.",
    consequence: "GST 18 / 12 / 0% and WELCOME10 snapshot onto the invoice lines. Editing the rule later changes nothing already issued.",
  },
  {
    on: "Ask your data, locally.",
    off: "Ask a stranger's cloud.",
    consequence: "The copilot streams from a local Ollama model with role-scoped tools: overdue lists, KPIs, plan advice. No keys, no uploads.",
  },
];

const PLANS = [
  {
    name: "Suite",
    cadence: "Monthly",
    price: "₹24,990",
    period: "/month",
    includes: "The full workspace: products, plans, subscriptions, invoices and payments. Billed with GST 18%, minimum one seat.",
    flags: ["auto-renews", "pausable", "early-cancellable"],
    cta: "Start with Suite",
  },
  {
    name: "Suite",
    cadence: "Yearly",
    price: "₹2,49,900",
    period: "/year",
    includes: "The same workspace, one invoice a year. Commitment pricing: no pause, no early cancel, by design.",
    flags: ["auto-renews", "no pause", "no early cancel"],
    cta: "Commit to a year",
  },
  {
    name: "CRM",
    cadence: "Monthly",
    price: "₹9,990",
    period: "/month",
    includes: "The CRM product alone, GST 18%, minimum three seats. A smaller loop to start with.",
    flags: ["auto-renews", "pausable", "min 3 seats"],
    cta: "Start with CRM",
  },
  {
    name: "Seat Pack",
    cadence: "Monthly",
    price: "₹1,990",
    period: "/month",
    includes: "Extra seats for an existing subscription, GST 12%, minimum five seats. The add-on that scales a team.",
    flags: ["auto-renews", "pausable", "min 5 seats"],
    cta: "Add seats",
  },
];

const FAQ = [
  [
    "Can a billing run create duplicate invoices?",
    "No. Billing records are unique per subscription and period. Re-running the pass skips anything already billed and reports what it skipped.",
  ],
  [
    "What happens to tax and discounts?",
    "They are calculated when an invoice is confirmed, then stored as snapshots beside the lines. Changing a rule later never rewrites issued history.",
  ],
  [
    "Can customers pause their own subscription?",
    "Only if the plan allows it. The portal reads the plan's flags before offering pause, resume or early cancel. The server enforces it again.",
  ],
  [
    "Where does the AI copilot run?",
    "On your machine. It is a local Ollama model streaming over SSE, with tools scoped to the signed-in role. Admins see more than customers.",
  ],
  [
    "Can we import our existing spreadsheet?",
    "Upload .xlsx or .csv, or paste rows. Headers are mapped locally, every row is previewed, and only rows you approve are committed.",
  ],
  [
    "How do I see all of this working?",
    "Open the demo and sign in as admin@brightloop.dev, staff@brightloop.dev or customer@brightloop.dev, password Bright@2025.",
  ],
];

export default function HomePage() {
  const [runState, setRunState] = useState<"idle" | "running" | "done">("idle");
  const [features, setFeatures] = useState([true, false, true, false]);
  const [stage, setStage] = useState(3);
  const [selected, setSelected] = useState(0);

  function runBilling() {
    if (runState !== "idle") return;
    setRunState("running");
    setTimeout(() => setRunState("done"), 900);
  }

  const s = STATES[stage]!;
  const plan = PLANS[selected]!;

  // Reveal-on-scroll: armed only once JS is running (no-JS visitors and the
  // reduced page always see the finished content), transform/opacity only.
  useEffect(() => {
    const root = document.querySelector(".lp");
    if (!root) return;
    root.classList.add("lp-armed");
    const els = Array.from(root.querySelectorAll(".lp-reveal"));
    if (!("IntersectionObserver" in window)) {
      els.forEach((el) => el.classList.add("is-inview"));
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            e.target.classList.add("is-inview");
            io.unobserve(e.target);
          }
        }
      },
      { threshold: 0.1 },
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);

  // The signature move: the hero loop turns as you scroll (independent
  // `rotate` so it composes with the CSS spin), rAF-throttled.
  useEffect(() => {
    const ring = document.querySelector<HTMLElement>(".lp-ring-outer");
    if (!ring) return;
    let raf = 0;
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        ring.style.rotate = `${(window.scrollY * 0.06).toFixed(1)}deg`;
      });
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <main className="lp">
      <header className="lp-nav">
        <Link href="/" className="lp-wordmark" aria-label="Brightloop home">
          <LoopMark size={22} /> Brightloop
        </Link>
        <nav className="lp-navlinks" aria-label="Page sections">
          <a href="#billing">Billing</a>
          <a href="#lifecycle">Lifecycle</a>
          <a href="#plans">Plans</a>
          <Link href="/login" className="lp-nav-signin">Sign in</Link>
        </nav>
      </header>

      {/* ------------------------------------------------ hero: the loop */}
      <section className="lp-hero">
        <div className="lp-hero-copy">
          <h1 id="lp-title">
            <span>Recurring revenue,</span> <span>in one loop.</span>
          </h1>
          <p>
            Brightloop keeps plans, lifecycle rules, invoices and payments in one auditable place. And the AI runs on your own machine.
          </p>
          <div className="lp-hero-actions">
            <Link className="lp-btn" href="/login">
              Open the demo
            </Link>
            <Link className="lp-btn lp-btn-ghost" href="/signup">
              Create an account
            </Link>
          </div>
        </div>

        <div className="lp-hero-art" role="img" aria-label="The Brightloop subscription lifecycle as a loop around a live subscription card">
          <span className="lp-ring lp-ring-outer" />
          <span className="lp-ring lp-ring-inner" />
          {STATES.map((st, i) => (
            <span key={st.id} className={`lp-node lp-node-${i}${stage === i ? " is-current" : ""}`}>
              {st.name}
            </span>
          ))}
          <div className="lp-hero-card" data-ui>
            <div className="lp-hero-card-top">
              <code className="lp-mono">SUB-2026-000001</code>
              <span className="lp-pill lp-pill-active">active</span>
            </div>
            <p className="lp-hero-card-label">Next billing</p>
            <p className="lp-hero-card-figure">₹26,539.38</p>
            <p className="lp-hero-card-sub">
              Sunrise Retail, CRM Monthly, 26 Nov 2026
            </p>
          </div>
        </div>
      </section>

      {/* --------------------------------------------- showcase: one run */}
      <section className="lp-run lp-reveal" id="billing">
        <div className="lp-run-copy">
          <h2>
            <span>One billing run.</span> <span>Zero double bills.</span>
          </h2>
          <p>
            A single pass drafts every invoice due today, renews what should renew and closes what has ended. Running it twice is safe: the period key says no.
          </p>
          <button data-ui className="lp-run-btn" onClick={runBilling} disabled={runState !== "idle"}>
            {runState === "idle" ? "Run billing for 31 Oct 2026" : runState === "running" ? "Running…" : "Run again"}
          </button>
          {runState === "running" && <p className="lp-run-note">Drafting invoices, renewing periods…</p>}
        </div>

        <div className="lp-run-result" data-ui aria-live="polite">
          {runState === "idle" ? (
            <div className="lp-run-empty">
              <code className="lp-mono">POST /api/v1/billing/run</code>
              <p>Press the button. This is the real endpoint the admin console uses.</p>
            </div>
          ) : (
            <div className="lp-run-card">
              <div className="lp-run-card-head">
                <code className="lp-mono">RUN · 2026-10-31</code>
                <span className="lp-pill lp-pill-done">completed</span>
              </div>
              <div className="lp-run-counts">
                <div><strong>4</strong><span>invoices created</span></div>
                <div><strong>3</strong><span>periods renewed</span></div>
                <div><strong>1</strong><span>subscription closed</span></div>
                <div><strong>0</strong><span>skipped</span></div>
              </div>
              <table>
                <thead>
                  <tr><th>Invoice</th><th>Customer</th><th className="num">Total</th></tr>
                </thead>
                <tbody>
                  <tr><td><code className="lp-mono">INV-2026-000001</code></td><td>Sunrise Retail</td><td className="num">₹26,539.38</td></tr>
                  <tr><td><code className="lp-mono">INV-2026-000002</code></td><td>Harbour Logistics</td><td className="num">₹11,788.20</td></tr>
                  <tr><td><code className="lp-mono">INV-2026-000003</code></td><td>Nimbus Clinics</td><td className="num">₹14,159.10</td></tr>
                </tbody>
              </table>
              <p className="lp-run-foot">Idempotent: a second run would create 0 and skip 4.</p>
            </div>
          )}
        </div>
      </section>

      {/* ------------------------------------------ features: switches */}
      <section className="lp-bands" aria-label="What Brightloop does">
        {FEATURES.map((f, i) => (
          <div key={f.on} className={`lp-band lp-reveal${features[i] ? " is-on" : ""}`}>
            <div className="lp-band-copy">
              <h2>{features[i] ? f.on : f.off}</h2>
              <p>{f.consequence}</p>
            </div>
            <button
              className="lp-switch"
              onClick={() => setFeatures((old) => old.map((v, j) => (j === i ? !v : v)))}
              aria-pressed={features[i]}
              aria-label={`Toggle: ${f.on}`}
            >
              <i />
            </button>
          </div>
        ))}
      </section>

      {/* -------------------------------------- lifecycle: six states */}
      <section className="lp-life lp-reveal" id="lifecycle">
        <div className="lp-life-copy">
          <h2>{s.clause}</h2>
          <p>{s.copy}</p>
        </div>

        <div className="lp-life-demo" data-ui>
          <div className="lp-life-card">
            <div className="lp-life-head">
              <code className="lp-mono">SUB-2026-000001</code>
              <span className={`lp-pill lp-pill-${s.id === "active" ? "active" : s.id === "closed" ? "neutral" : "warn"}`}>{s.id}</span>
            </div>
            <div className="lp-life-row"><span>Customer</span><strong>Sunrise Retail</strong></div>
            <div className="lp-life-row"><span>Plan</span><strong>CRM — Monthly</strong></div>
            <div className="lp-life-row"><span>Next billing</span><strong>{s.next}</strong></div>
            <div className="lp-life-event">{s.event}</div>
            <div className="lp-life-actions">
              {s.actions.length > 0 ? (
                s.actions.map((a, i) => (
                  <span key={a} className={`lp-life-action${i === 0 ? " is-primary" : ""}`}>{a}</span>
                ))
              ) : (
                <span className="lp-life-none">no transitions left. The ledger is closed.</span>
              )}
            </div>
          </div>
        </div>

        <div className="lp-life-slider">
          <input
            type="range"
            min={0}
            max={5}
            value={stage}
            onChange={(e) => setStage(Number(e.target.value))}
            aria-label="Subscription lifecycle stage"
            aria-valuetext={s.name}
          />
          <div className="lp-life-ticks">
            {STATES.map((st, i) => (
              <button key={st.id} className={stage === i ? "is-current" : ""} onClick={() => setStage(i)}>
                {st.name}
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* --------------------------------------- import: paste to rows */}
      <section className="lp-import lp-reveal" id="import">
        <div className="lp-import-copy">
          <h2>
            <span>Paste a spreadsheet.</span> <span>Get clean rows.</span>
          </h2>
          <p>
            The copilot maps your headers locally, shows every row before anything is written, and never invents a value that was not there. You commit, it obeys.
          </p>
        </div>
        <div className="lp-import-demo" data-ui>
          <div className="lp-import-pane">
            <p className="lp-import-label">pasted</p>
            <pre>{`name, price, kind
GraphQL Booster, 1299, addon
Email Relay Pro, 499, service`}</pre>
          </div>
          <div className="lp-import-arrow" aria-hidden>→</div>
          <div className="lp-import-pane">
            <p className="lp-import-label">staged preview · 3 of 3 valid</p>
            <table>
              <thead><tr><th>name</th><th className="num">sales price</th><th>kind</th><th /></tr></thead>
              <tbody>
                <tr><td>GraphQL Booster</td><td className="num">₹1,299.00</td><td>addon</td><td><span className="lp-pill lp-pill-done">valid</span></td></tr>
                <tr><td>Email Relay Pro</td><td className="num">₹499.00</td><td>service</td><td><span className="lp-pill lp-pill-done">valid</span></td></tr>
              </tbody>
            </table>
            <span className="lp-import-commit">Commit 2 products</span>
          </div>
        </div>
      </section>

      {/* ------------------------------------------------ pricing index */}
      <section className="lp-pricing lp-reveal" id="plans">
        <div className="lp-pricing-names" role="tablist" aria-label="Demo plans">
          {PLANS.map((p, i) => (
            <button
              key={`${p.name}-${p.cadence}`}
              role="tab"
              aria-selected={selected === i}
              className={selected === i ? "is-current" : ""}
              onClick={() => setSelected(i)}
            >
              {p.name} <em>{p.cadence}</em>
              <i className="lp-dot" />
            </button>
          ))}
        </div>
        <div className="lp-pricing-stage" data-ui>
          <p className="lp-price">
            {plan.price}
            <span>{plan.period}</span>
          </p>
          <p className="lp-price-sub">
            {plan.name} {plan.cadence}, GST invoiced at confirm
          </p>
          <p className="lp-price-copy">{plan.includes}</p>
          <ul className="lp-price-flags">
            {plan.flags.map((f) => (
              <li key={f}>{f}</li>
            ))}
          </ul>
          <Link className="lp-btn" href="/login">
            {plan.cta}
          </Link>
        </div>
        <p className="lp-pricing-note">Live from the seeded demo workspace. You can create these exact plans in the console in under a minute.</p>
      </section>

      {/* --------------------------------------------------------- faq */}
      <section className="lp-faq lp-reveal" id="faq">
        <div className="lp-faq-head">
          <h2>Asked, answered.</h2>
          <p>The questions the judges, sorry, customers, actually ask.</p>
        </div>
        <div className="lp-faq-list">
          {FAQ.map(([q, a]) => (
            <details key={q}>
              <summary>
                {q}
                <span aria-hidden />
              </summary>
              <p>{a}</p>
            </details>
          ))}
        </div>
      </section>

      {/* --------------------------------------------------------- cta */}
      <Link href="/login" className="lp-cta">
        <span className="lp-cta-note">Seeded and ready. Sign in as admin@brightloop.dev, password Bright@2025.</span>
        <span className="lp-cta-word">
          DEMO
          <svg viewBox="0 0 48 48" width="44" height="44" aria-hidden>
            <path d="M10 38 38 10M16 10h22v22" fill="none" stroke="currentColor" strokeWidth="4" />
          </svg>
        </span>
      </Link>

      {/* ------------------------------------------------------ footer */}
      <footer className="lp-footer">
        <div className="lp-footer-mark" aria-hidden>
          <LoopMark size={72} />
          <span>Brightloop</span>
        </div>
        <div className="lp-footer-grid">
          <div>
            <b>Page</b>
            <a href="#billing">Billing run</a>
            <a href="#lifecycle">Lifecycle</a>
            <a href="#plans">Plans</a>
            <a href="#faq">FAQ</a>
          </div>
          <div>
            <b>Workspace</b>
            <Link href="/login">Sign in</Link>
            <Link href="/signup">Create account</Link>
            <Link href="/mailbox">Dev mailbox</Link>
          </div>
          <div>
            <b>Under the hood</b>
            <p>Fastify · PostgreSQL · Next.js</p>
            <p>Ollama runs locally</p>
            <p>Session cookies + CSRF</p>
          </div>
          <div>
            <b>Brightloop</b>
            <p>Subscriptions, billed on time.</p>
            <p>© 2026, built for the Odoo virtual hackathon.</p>
          </div>
        </div>
      </footer>
    </main>
  );
}

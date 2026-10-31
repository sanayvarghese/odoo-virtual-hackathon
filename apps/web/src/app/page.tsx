"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { LoopMark } from "@/components/app-shell";
import { get } from "@/lib/api";
import "./landing.css";

/**
 * Brightloop public page — rebuilt fresh: calm editorial layout, no scroll
 * gimmicks. Plans are LIVE from the public catalogue (GET /plans/public, the
 * admin's real data); "Subscribe" continues into login → portal checkout.
 */

interface PublicPlan {
  id: number;
  name: string;
  description: string | null;
  interval: string;
  price: number; // cents per period
  minQty: number;
  autoRenew: boolean;
  allowPause: boolean;
  allowEarlyCancel: boolean;
  autoCloseAtEnd: boolean;
  validTo: string | null;
  productName: string;
  productSku: string;
}

const INTERVAL_LABEL: Record<string, string> = {
  daily: "day",
  weekly: "week",
  monthly: "month",
  yearly: "year",
};

const STATES = [
  ["Draft", "Built from a plan, a product and a quantity. Nothing bills yet."],
  ["Quotation", "An accountable offer the customer can read, still editable."],
  ["Confirmed", "GST and discounts snapshot onto the invoice. History is locked."],
  ["Active", "Billed exactly once per period. Pause or renew by plan rules."],
  ["Paused", "Billing held where the plan allows it. History and MRR stay put."],
  ["Closed", "Ends at expiry or early by rule, with every step in the timeline."],
];

export default function HomePage() {
  const [plans, setPlans] = useState<PublicPlan[] | null>(null);
  const [planError, setPlanError] = useState(false);
  const [signedIn, setSignedIn] = useState<boolean | null>(null);

  // Reveal-on-scroll: sections render visible; when one first enters the
  // viewport, JS animates it in with inline styles (transform/opacity). This
  // is the motion source that works even when the OS forces reduced motion
  // (CSS animations are blocked there); under reduce it degrades to a quick
  // opacity ease. The reduced page still ends fully visible.
  useEffect(() => {
    const els = Array.from(document.querySelectorAll<HTMLElement>(".lp-reveal"));
    if (!("IntersectionObserver" in window)) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          const el = e.target as HTMLElement;
          io.unobserve(el);
          if (el.dataset.revealed) continue;
          el.dataset.revealed = "1";
          el.style.transition = reduce ? "opacity 200ms ease" : "opacity 560ms ease, transform 560ms ease";
          el.style.opacity = "0";
          if (!reduce) el.style.transform = "translateY(18px)";
          requestAnimationFrame(() =>
            requestAnimationFrame(() => {
              el.style.opacity = "1";
              el.style.transform = "none";
            }),
          );
        }
      },
      { threshold: 0.08 },
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);

  // live catalogue + a quiet auth probe so Subscribe knows where to send you
  useEffect(() => {
    get<{ items: PublicPlan[] }>("/plans/public")
      .then((r) => setPlans(r.items))
      .catch(() => setPlanError(true));
    get("/auth/me")
      .then(() => setSignedIn(true))
      .catch(() => setSignedIn(false));
  }, []);

  function subscribeHref(plan: PublicPlan): string {
    const target = `/portal/plans?subscribe=${plan.id}`;
    return signedIn ? target : `/login?next=${encodeURIComponent(target)}`;
  }

  return (
    <main className="lp">
      <header className="lp-nav">
        <Link href="/" className="lp-wordmark" aria-label="Brightloop home">
          <LoopMark size={22} /> Brightloop
        </Link>
        <nav className="lp-navlinks" aria-label="Page sections">
          <a href="#lifecycle">Lifecycle</a>
          <a href="#plans">Plans</a>
          <a href="#billing">Billing</a>
          <Link href="/login" className="lp-nav-signin">Sign in</Link>
        </nav>
      </header>

      {/* ------------------------------------------------------ hero */}
      <section className="lp-hero">
        <div className="lp-hero-copy">
          <h1 id="lp-title">
            <span>Subscriptions,</span> <span>billed on time.</span>
          </h1>
          <p>
            Brightloop keeps plans, lifecycle rules, invoices and payments in one auditable workspace, and the AI copilot runs on your own machine.
          </p>
          <div className="lp-hero-actions">
            <Link className="lp-btn" href="#plans">
              See the plans
            </Link>
            <Link className="lp-btn lp-btn-ghost" href="/login">
              Sign in
            </Link>
          </div>
        </div>

        {/* a real fragment of the console: the overview, at rest */}
        <div className="lp-hero-shot" data-ui role="img" aria-label="The Brightloop overview: monthly revenue, MRR, outstanding and the subscriptions pipeline">
          <div className="lp-shot-head">
            <span className="lp-shot-title">Overview</span>
            <code className="lp-mono">Tue 31 Oct 2026</code>
          </div>
          <div className="lp-shot-kpis">
            <div>
              <span><abbr className="lp-abbr" title="MRR — Monthly Recurring Revenue: every active subscription normalized to a month">MRR</abbr></span>
              <strong>₹1,11,761.67</strong>
            </div>
            <div>
              <span>Collected</span>
              <strong>₹3,40,186.84</strong>
            </div>
            <div>
              <span>Outstanding</span>
              <strong>₹26,539.38</strong>
            </div>
          </div>
          <svg className="lp-shot-chart" viewBox="0 0 520 120" preserveAspectRatio="none" aria-hidden>
            <polyline
              fill="none"
              stroke="#1d5fbf"
              strokeWidth="2"
              points="0,96 74,88 148,90 222,64 296,58 370,34 444,30 520,12"
            />
            <polyline fill="none" stroke="#8a8a8a" strokeWidth="1" strokeDasharray="3 3" points="0,104 520,104" />
          </svg>
          <div className="lp-shot-rows">
            <div>
              <code className="lp-mono">INV-2026-000001</code>
              <span>Sunrise Retail</span>
              <b>₹26,539.38</b>
            </div>
            <div>
              <code className="lp-mono">INV-2026-000002</code>
              <span>Harbour Logistics</span>
              <b>₹11,788.20</b>
            </div>
          </div>
        </div>
      </section>

      {/* -------------------------------------------------- lifecycle */}
      <section className="lp-states lp-reveal" id="lifecycle">
        <div className="lp-section-head">
          <h2>
            <span>Six states.</span> <span>Nothing skips one.</span>
          </h2>
          <p>Every subscription walks the same path, and the server refuses any shortcut.</p>
        </div>
        <ol className="lp-state-track">
          {STATES.map(([name, copy], i) => (
            <li key={name}>
              <span className="lp-state-num">{i + 1}</span>
              <strong>{name}</strong>
              <p>{copy}</p>
            </li>
          ))}
        </ol>
      </section>

      {/* ------------------------------------------------------ plans */}
      <section className="lp-plans" id="plans">
        <div className="lp-section-head">
          <h2>
            <span>Pick a plan.</span> <span>Subscribe in a minute.</span>
          </h2>
          <p>
            Live from the workspace catalogue, exactly as the admin published it. Choose one and the checkout continues after you sign in.
          </p>
        </div>

        {planError ? (
          <p className="lp-plans-error">The catalogue is offline right now — the API on :4000 is not reachable.</p>
        ) : plans === null ? (
          <div className="lp-plan-grid">
            {[0, 1, 2].map((i) => (
              <div key={i} className="lp-plan-card lp-plan-skeleton" aria-hidden />
            ))}
          </div>
        ) : plans.length === 0 ? (
          <p className="lp-plans-error">No plans are open for subscription right now.</p>
        ) : (
          <div className="lp-plan-grid">
            {plans.map((p) => (
              <article key={p.id} className="lp-plan-card lp-reveal">
                <div className="lp-plan-top">
                  <div>
                    <p><code className="lp-mono">{p.productSku}</code></p>
                    <h3>{p.name}</h3>
                  </div>
                  <span className="lp-pill lp-pill-neutral">{p.interval}</span>
                </div>
                {p.description && <p className="lp-plan-desc">{p.description}</p>}
                <p className="lp-plan-price">
                  ₹{(p.price / 100).toLocaleString("en-IN", { maximumFractionDigits: 0 })}
                  <span> / {INTERVAL_LABEL[p.interval] ?? p.interval}</span>
                </p>
                {p.minQty > 1 && <p className="lp-plan-min">minimum {p.minQty} seats</p>}
                <ul className="lp-plan-flags">
                  {p.autoRenew && <li>auto-renews</li>}
                  {p.allowPause && <li>pausable</li>}
                  {p.allowEarlyCancel && <li>early-cancellable</li>}
                  {p.autoCloseAtEnd && <li>closes at end date</li>}
                </ul>
                <Link className="lp-btn lp-plan-cta" href={subscribeHref(p)}>
                  Subscribe
                </Link>
              </article>
            ))}
          </div>
        )}
      </section>

      {/* ----------------------------------------------------- billing */}
      <section className="lp-billing lp-reveal" id="billing">
        <div className="lp-section-head">
          <h2>
            <span>Billing that can't</span> <span>double bill.</span>
          </h2>
          <p>
            One admin pass drafts every invoice due today, renews periods and closes ended subscriptions. The invoice key is the subscription plus its period, so a rerun creates nothing and skips everything it already did.
          </p>
        </div>
        <div className="lp-billing-grid">
          <div className="lp-run-card lp-reveal" data-ui role="img" aria-label="A completed billing run: 4 invoices created, 3 renewed, 1 closed, 0 skipped">
            <div className="lp-run-head">
              <code className="lp-mono">RUN · 2026-10-31</code>
              <span className="lp-pill lp-pill-active">completed</span>
            </div>
            <div className="lp-run-counts">
              <div><strong>4</strong><span>created</span></div>
              <div><strong>3</strong><span>renewed</span></div>
              <div><strong>1</strong><span>closed</span></div>
              <div><strong>0</strong><span>skipped</span></div>
            </div>
            <p className="lp-run-foot">A second run: created 0, skipped 4.</p>
          </div>
          <div className="lp-inv-card lp-reveal" data-ui role="img" aria-label="An invoice with GST and a discount snapshotted at confirm time">
            <div className="lp-run-head">
              <code className="lp-mono">INV-2026-000001</code>
              <span className="lp-pill lp-pill-active">paid</span>
            </div>
            <div className="lp-inv-lines">
              <div><span>Brightloop CRM — Monthly × 5</span><b>₹49,950.00</b></div>
              <div><span className="lp-disc">WELCOME10 − 10%</span><b className="lp-disc">−₹4,995.00</b></div>
              <div><span>GST 18%</span><b>₹8,091.00</b></div>
            </div>
            <div className="lp-inv-total">
              <span>Total</span>
              <b>₹26,539.38</b>
            </div>
            <p className="lp-run-foot">Tax and discounts froze at confirm time.</p>
          </div>
        </div>
      </section>

      {/* --------------------------------------------------------- ai */}
      <section className="lp-ai lp-reveal" id="ai">
        <div className="lp-section-head">
          <h2>
            <span>An AI that works</span> <span>where your data is.</span>
          </h2>
          <p>
            The copilot streams answers from a local Ollama model with tools scoped to your role: overdue lists, KPIs, plan advice, even drafting a quotation. Nothing leaves your machine.
          </p>
        </div>
        <div className="lp-import-grid">
          <div className="lp-import-pane lp-reveal" data-ui role="img" aria-label="Pasted spreadsheet rows about to be mapped">
            <p className="lp-import-label">pasted in the copilot dock</p>
            <pre>{`name, price, kind
GraphQL Booster, 1299, addon
Email Relay Pro, 499, service
Data Vault 100GB, 1599, addon`}</pre>
          </div>
          <div className="lp-import-pane lp-reveal" data-ui role="img" aria-label="Staged preview: every row validated before anything is written">
            <p className="lp-import-label">staged preview · 3 of 3 valid</p>
            <table>
              <thead><tr><th>name</th><th className="num">price</th><th>kind</th><th /></tr></thead>
              <tbody>
                <tr><td>GraphQL Booster</td><td className="num">₹1,299</td><td>addon</td><td><span className="lp-pill lp-pill-active">valid</span></td></tr>
                <tr><td>Email Relay Pro</td><td className="num">₹499</td><td>service</td><td><span className="lp-pill lp-pill-active">valid</span></td></tr>
                <tr><td>Data Vault 100GB</td><td className="num">₹1,599</td><td>addon</td><td><span className="lp-pill lp-pill-active">valid</span></td></tr>
              </tbody>
            </table>
            <p className="lp-import-note">Reviewed under Products, then committed. The model may fix formatting; it may never invent a value.</p>
          </div>
        </div>
      </section>

      {/* --------------------------------------------------------- cta */}
      <Link href="/login" className="lp-cta">
        <span className="lp-cta-note">A full demo workspace is waiting — sign in and click around.</span>
        <span className="lp-cta-word">
          Open the demo
          <svg viewBox="0 0 48 48" width="40" height="40" aria-hidden>
            <path d="M10 38 38 10M16 10h22v22" fill="none" stroke="currentColor" strokeWidth="4" />
          </svg>
        </span>
      </Link>

      {/* ------------------------------------------------------ footer */}
      <footer className="lp-footer">
        <div className="lp-footer-mark" aria-hidden>
          <LoopMark size={64} />
          <span>Brightloop</span>
        </div>
        <div className="lp-footer-grid">
          <div>
            <b>Page</b>
            <a href="#lifecycle">Lifecycle</a>
            <a href="#plans">Plans</a>
            <a href="#billing">Billing</a>
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

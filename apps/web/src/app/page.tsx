"use client";

import Link from "next/link";
import { useState } from "react";
import { LoopMark } from "@/components/app-shell";
import { money } from "@/lib/format";
import "./landing.css";

const plans = [
  { name: "Starter", price: 1499_00, period: "month", text: "For one product and a clear first recurring offer.", seats: "from 3 seats" },
  { name: "Growth", price: 4999_00, period: "month", text: "For teams with plans, discounts and a busy invoice queue.", seats: "from 12 seats" },
  { name: "Scale", price: 11999_00, period: "month", text: "For recurring revenue that needs its whole lifecycle in view.", seats: "unlimited operators" },
];

const stages = [
  ["Draft", "Build the subscription from a plan, product and quantity."],
  ["Quotation", "Send an accountable offer, still editable until confirmed."],
  ["Confirmed", "Lock the commercial agreement before it turns live."],
  ["Active", "Bill exactly once per period; pause, renew or close by rule."],
];

export default function HomePage() {
  const [automation, setAutomation] = useState(true);
  const [features, setFeatures] = useState([true, false, true, false]);
  const [stage, setStage] = useState(3);
  const [selected, setSelected] = useState(1);

  function featureToggle(index: number) {
    setFeatures((old) => old.map((v, i) => (i === index ? !v : v)));
  }

  return (
    <main className="bl-page">
      <header className="bl-nav">
        <Link href="/" className="bl-wordmark" aria-label="Brightloop home">
          <LoopMark size={24} /> Brightloop
        </Link>
        <div className="bl-navlinks">
          <a href="#lifecycle">Lifecycle</a>
          <a href="#plans">Plans</a>
          <Link href="/login">Sign in</Link>
        </div>
      </header>

      <section className="bl-hero" aria-labelledby="hero-title">
        <div className="bl-hero-copy">
          <h1 id="hero-title">Revenue loops.</h1>
          <p className="bl-hero-text">
            Brightloop puts plans, lifecycle rules, invoices and payments in one auditable run â€” with a local AI copilot that knows your data.
          </p>
          <div className="bl-hero-actions">
            <Link className="bl-button bl-button-dark" href="/signup">Start with Brightloop <span aria-hidden>â†—</span></Link>
            <Link className="bl-text-link" href="/login">Open the demo <span aria-hidden>â†’</span></Link>
          </div>
        </div>
        <div className="bl-hero-art" aria-label="A recurring billing lifecycle, from draft to active">
          <div className="bl-orbit bl-orbit-outer" />
          <div className="bl-orbit bl-orbit-inner" />
          <div className="bl-center-card" data-ui>
            <span className="bl-ui-label">Next billing</span>
            <strong>â‚¹26,539.38</strong>
            <span>26 Nov 2026 Â· SUB-2026-000001</span>
          </div>
          {stages.map(([name], index) => (
            <span className={`bl-orbit-node node-${index}`} key={name}>{name}</span>
          ))}
          <span className="bl-orbit-label">One lifecycle, no loose ends</span>
        </div>
      </section>

      <section className={`bl-control-section ${automation ? "is-on" : ""}`} id="automation">
        <div className="bl-section-copy">
          <h2>{automation ? "Let billing run itself." : "Keep every bill manual."}</h2>
          <p>One safe run finds subscriptions due today. A unique billing period key ensures it can never bill the same period twice.</p>
        </div>
        <button data-ui className="bl-mega-switch" aria-pressed={automation} onClick={() => setAutomation(!automation)}>
          <span>{automation ? "ON" : "OFF"}</span><i />
          <em>{automation ? "Due subscriptions billed" : "No billing pass"}</em>
        </button>
      </section>

      <section className="bl-feature-bands" aria-label="Brightloop capabilities">
        {[
          ["Bill each period exactly once.", "The invoice key is the subscription plus its billing period."],
          ["Let plans set the rules.", "Pause, cancel and renewal controls are attached to each plan."],
          ["Freeze tax when you confirm.", "GST and discounts snapshot into the invoice, never rewrite history."],
          ["Ask the data, locally.", "The Brightloop AI copilot streams local Ollama answers with role-scoped tools."],
        ].map(([sentence, consequence], i) => (
          <div className={`bl-feature-band ${features[i] ? "is-on" : ""}`} key={sentence}>
            <div><h2>{sentence}</h2>{features[i] && <p>{consequence}</p>}</div>
            <button className="bl-small-switch" onClick={() => featureToggle(i)} aria-pressed={features[i]} aria-label={`Toggle ${sentence}`}><i /></button>
          </div>
        ))}
      </section>

      <section className="bl-lifecycle" id="lifecycle">
        <div className="bl-life-sticky"><h2>{stages[stage]![0]} is a real state.</h2><p>{stages[stage]![1]}</p></div>
        <div className="bl-life-demo" data-ui>
          <div className="bl-demo-window">
            <div className="bl-demo-head"><LoopMark size={18} /><span>SUB-2026-000001</span><b className={`state-${stages[stage]![0].toLowerCase()}`}>{stages[stage]![0]}</b></div>
            <div className="bl-demo-body">
              <div><span>Customer</span><strong>Sunrise Retail</strong></div><div><span>Plan</span><strong>Growth Â· monthly</strong></div>
              <div className="bl-demo-line"><span>Latest event</span><strong>{stage === 3 ? "Auto-renewed to 26 Nov" : `Moved to ${stages[stage]![0].toLowerCase()}`}</strong></div>
              <div className="bl-demo-total"><span>Next invoice</span><strong>{stage === 3 ? "â‚¹26,539.38" : "â€”"}</strong></div>
            </div>
          </div>
        </div>
        <div className="bl-range-wrap"><input type="range" min="0" max="3" value={stage} onChange={(e) => setStage(Number(e.target.value))} aria-label="Subscription lifecycle stage" />
          <div className="bl-range-labels">{stages.map(([name], i) => <button key={name} className={stage === i ? "active" : ""} onClick={() => setStage(i)}>{name}</button>)}</div>
        </div>
      </section>

      <section className="bl-pricing" id="plans">
        <div className="bl-pricing-list">{plans.map((p, i) => <button key={p.name} onClick={() => setSelected(i)} className={selected === i ? "selected" : ""}>{p.name}<i /></button>)}</div>
        <div className="bl-price-stage">
          <strong>{money(plans[selected]!.price)}</strong><span>per {plans[selected]!.period} · {plans[selected]!.seats}</span>
          <p className="bl-price-copy">{plans[selected]!.text}</p>
          <Link className="bl-button bl-button-dark" href="/signup">Choose {plans[selected]!.name}</Link>
        </div>
      </section>

      <section className="bl-faq" id="faq"><div><h2>Rules, recorded.</h2></div><div className="bl-faq-list">
        {[
          ["Can a billing run create duplicate invoices?", "No. Billing records are unique per subscription and period. Re-running safely skips something already billed."],
          ["What happens to tax and discounts?", "They are calculated when the invoice is confirmed, then stored as snapshots alongside the lines."],
          ["Can customers pause their own subscription?", "Only if the plan allows it. The portal reads those plan flags before presenting an action."],
          ["Is the AI copilot cloud-hosted?", "No. The demo uses a local Ollama model, streams its work, and only exposes tools allowed for the signed-in role."],
          ["Can we import our existing sheet?", "Yes. Upload Excel/CSV or paste rows. Brightloop maps headers locally, previews every row, then imports only when you approve."],
          ["What is the demo login?", "Use admin@brightloop.dev, staff@brightloop.dev or customer@brightloop.dev with Bright@2025."],
        ].map(([q, a]) => <details key={q}><summary>{q}<span>+</span></summary><p>{a}</p></details>)}
      </div></section>

      <Link href="/signup" className="bl-cta"><span>Your recurring revenue has a home.</span><strong>START <i>â†—</i></strong></Link>

      <footer className="bl-footer"><div className="bl-footer-mark"><LoopMark size={88} /><span>BRIGHTLOOP</span></div><div className="bl-footer-grid"><div><b>Product</b><a href="#lifecycle">Lifecycle</a><a href="#plans">Plans</a><a href="#faq">FAQ</a></div><div><b>Workspace</b><Link href="/login">Sign in</Link><Link href="/signup">Create account</Link><Link href="/mailbox">Dev mailbox</Link></div><div><b>Built for the demo</b><p>Fastify + PostgreSQL + Next.js</p><p>Ollama runs locally</p></div><div><b>Brightloop</b><p>Subscriptions, billed on time.</p><p>Â© 2026</p></div></div></footer>
    </main>
  );
}

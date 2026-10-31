"use client";

import type { ReactNode } from "react";

/** Subscription / invoice states map to the four pill tones in the direction. */
const TONES: Record<string, string> = {
  // subscriptions
  draft: "pill-neutral",
  quotation: "pill-warning",
  confirmed: "pill-warning",
  active: "pill-positive",
  paused: "pill-neutral",
  cancel_requested: "pill-warning",
  cancelled: "pill-negative",
  closed: "pill-neutral",
  past_due: "pill-negative",
  // invoices
  paid: "pill-positive",
  partially_paid: "pill-warning",
  sent: "pill-neutral",
  void: "pill-neutral",
  failed: "pill-negative",
  refunded: "pill-neutral",
  // users / misc
  verified: "pill-positive",
  pending: "pill-warning",
  enabled: "pill-positive",
  disabled: "pill-neutral",
};

export function StatusPill({ status, children }: { status: string; children?: ReactNode }) {
  return (
    <span className={`pill ${TONES[status.toLowerCase()] ?? "pill-neutral"}`}>
      {children ?? status.replace(/_/g, " ")}
    </span>
  );
}

export function Delta({ value, suffix = "%" }: { value: number; suffix?: string }) {
  // Small change signal — the only hue outside the chart.
  if (!isFinite(value) || value === 0) return <span className="text-muted text-xs tnum">0{suffix}</span>;
  const up = value > 0;
  return (
    <span className={`text-xs tnum ${up ? "delta-up" : "delta-down"}`}>
      {Math.abs(value).toLocaleString("en-IN", { maximumFractionDigits: 1 })}
      {suffix}
    </span>
  );
}

export function SectionTitle({ title, desc, action }: { title: string; desc?: string; action?: ReactNode }) {
  return (
    <div className="flex items-start justify-between mb-5">
      <div>
        <h1 className="text-[24px] leading-tight font-medium">{title}</h1>
        {desc ? <p className="text-muted mt-1">{desc}</p> : null}
      </div>
      {action ? <div className="flex gap-2">{action}</div> : null}
    </div>
  );
}

export function EmptyState({ title, hint, action }: { title: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center py-14 text-center">
      <p className="font-medium text-ink">{title}</p>
      {hint ? <p className="text-muted text-sm mt-1 max-w-sm">{hint}</p> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

export function LoadingRows({ rows = 4 }: { rows?: number }) {
  return (
    <div className="p-6 space-y-3" aria-busy="true">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="h-10 rounded-[6px]" style={{ background: "#f5f5f5" }} />
      ))}
    </div>
  );
}

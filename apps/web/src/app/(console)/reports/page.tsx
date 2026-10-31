"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { get } from "@/lib/api";
import { money, monthShort } from "@/lib/format";
import { LineChart, type SeriesPoint } from "@/components/line-chart";
import { SectionTitle, LoadingRows } from "@/components/ui";

type Metric = "revenue" | "mrr" | "subscriptions";

interface RevenueRow {
  month: string;
  amount: string | number;
  payments: number;
}
interface MrrRow {
  interval: string;
  subs: number;
  mrr_cents: string | number;
}
interface StatusRow {
  status: string;
  count_t: number;
}

export default function ReportsPage() {
  const [metric, setMetric] = useState<Metric>("revenue");

  const revenue = useQuery({
    queryKey: ["series", "revenue"],
    queryFn: () => get<{ items: RevenueRow[] }>("/reports/series?metric=revenue"),
  });
  const mrr = useQuery({
    queryKey: ["series", "mrr"],
    queryFn: () => get<{ items: MrrRow[] }>("/reports/series?metric=mrr"),
  });
  const subs = useQuery({
    queryKey: ["series", "subscriptions"],
    queryFn: () => get<{ items: StatusRow[] }>("/reports/series?metric=subscriptions"),
  });

  const series = useMemo<SeriesPoint[]>(
    () =>
      (revenue.data?.items ?? []).map((r) => ({
        label: r.month.slice(0, 7),
        value: Number(r.amount),
      })),
    [revenue.data],
  );

  const tabs: { id: Metric; label: string }[] = [
    { id: "revenue", label: "Cash collected" },
    { id: "mrr", label: "MRR by interval" },
    { id: "subscriptions", label: "Pipeline" },
  ];

  return (
    <>
      <SectionTitle title="Reports" desc="What the business collected, commits to, and owes." />

      {/* KPI tabs: the selected one carries a 2px rule and an ink label */}
      <div className="flex gap-8 px-6 pt-5 mb-3 card" style={{ borderBottom: "1px solid var(--color-rule)", borderRadius: 8 }}>
        {tabs.map((t) => {
          const active = metric === t.id;
          return (
            <div key={t.id} className="relative pt-1">
              <button
                onClick={() => setMetric(t.id)}
                className={`text-sm cursor-pointer pb-3 ${active ? "text-ink font-medium" : "text-muted hover:text-ink"}`}
              >
                {t.label}
              </button>
              {active && (
                <span
                  className="absolute left-0 right-0 bottom-0"
                  style={{ height: 2, background: "var(--color-ink)" }}
                />
              )}
            </div>
          );
        })}
      </div>

      {metric === "revenue" && (
        <div className="card mt-3 p-6">
          <h2 className="text-[16px] font-medium">Cash collected per month</h2>
          <div className="mt-5">
            {revenue.isLoading ? <LoadingRows rows={3} /> : (
              <LineChart
                series={series}
                hue="#1d5fbf"
                height={240}
                format={(v) => money(v)}
                formatTick={(v) => {
                  const k = Math.abs(v) / 100000;
                  return `₹${k >= 10 ? k.toFixed(0) : k.toFixed(1)}L`;
                }}
                ariaLabel="Cash collected per month, 24 months"
              />
            )}
          </div>
          <table className="btable mt-4">
            <thead>
              <tr>
                <th>Month</th>
                <th className="num">Collected</th>
                <th className="num">Payments</th>
              </tr>
            </thead>
            <tbody>
              {(revenue.data?.items ?? [])
                .slice(-3)
                .reverse()
                .map((r) => (
                  <tr key={r.month}>
                    <td>{monthShort(r.month.slice(0, 7))}</td>
                    <td className="num money">{money(Number(r.amount))}</td>
                    <td className="num">{r.payments}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      )}

      {metric === "mrr" && (
        <div className="card mt-3 p-6">
          <h2 className="text-[16px] font-medium">Recurring revenue by billing interval</h2>
          {mrr.isLoading ? (
            <LoadingRows rows={3} />
          ) : (
            <>
              <IntervalBars items={mrr.data?.items ?? []} />
              <table className="btable mt-4">
                <thead>
                  <tr>
                    <th>Interval</th>
                    <th className="num">Subscriptions</th>
                    <th className="num">MRR</th>
                  </tr>
                </thead>
                <tbody>
                  {(mrr.data?.items ?? []).map((r) => (
                    <tr key={r.interval}>
                      <td className="capitalize">{r.interval}</td>
                      <td className="num">{r.subs}</td>
                      <td className="num money">{money(Number(r.mrr_cents))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </div>
      )}

      {metric === "subscriptions" && (
        <div className="card mt-3 p-6">
          <h2 className="text-[16px] font-medium">Pipeline — subscriptions by state</h2>
          {subs.isLoading ? (
            <LoadingRows rows={3} />
          ) : (
            <>
              <IntervalBars
                items={(subs.data?.items ?? []).map((r) => ({
                  interval: r.status,
                  subs: r.count_t,
                  mrr_cents: r.count_t,
                }))}
                valueLabel={(v) => `${v}`}
                fmt="count"
              />
              <table className="btable mt-4">
                <thead>
                  <tr>
                    <th>State</th>
                    <th className="num">Count</th>
                  </tr>
                </thead>
                <tbody>
                  {(subs.data?.items ?? []).map((r) => (
                    <tr key={r.status}>
                      <td className="capitalize">{r.status.replace(/_/g, " ")}</td>
                      <td className="num money">{r.count_t}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </div>
      )}
    </>
  );
}

/** Simple ink bars — one data element, no gradients, labelled with real values. */
function IntervalBars({
  items,
  valueLabel,
  fmt,
}: {
  items: { interval: string; subs: number; mrr_cents: string | number }[];
  valueLabel?: (v: number) => string;
  fmt?: "count";
}) {
  const clean = items.filter((r) => Number(r.mrr_cents) > 0 || r.subs > 0);
  if (clean.length === 0) {
    return <p className="text-sm text-muted py-8 text-center">Nothing scheduled yet — the numbers will land here.</p>;
  }
  const byMrr = fmt !== "count";
  const rows = [...clean].map((r) => ({
    label: r.interval,
    sub: r.subs,
    value: byMrr ? Number(r.mrr_cents) : r.subs,
  }));
  const max = Math.max(...rows.map((r) => r.value)) || 1;

  return (
    <div className="mt-5 flex flex-col gap-4">
      {rows
        .sort((a, b) => b.value - a.value)
        .map((r) => (
          <div key={r.label}>
            <div className="flex items-baseline justify-between mb-1.5">
              <span className="text-sm capitalize">{r.label.replace(/_/g, " ")}</span>
              <span className="text-sm money">
                {byMrr ? money(r.value) : r.value}
                {r.sub > 0 && byMrr ? (
                  <span className="text-faint font-normal text-xs ml-2">{r.sub} subs</span>
                ) : null}
              </span>
            </div>
            <div className="h-[22px] rounded-[4px] overflow-hidden" style={{ background: "#f5f5f5" }}>
              <div
                className="h-full rounded-[4px]"
                style={{
                  width: `${Math.max(3, (r.value / max) * 100)}%`,
                  background: "var(--color-ledger)", // the one chart hue marks the main data element
                  transition: "width 400ms ease",
                }}
              />
            </div>
          </div>
        ))}
    </div>
  );
}

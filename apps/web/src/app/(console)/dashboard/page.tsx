"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { get } from "@/lib/api";
import { money, dateShort, dueLabel } from "@/lib/format";
import { LineChart, type SeriesPoint } from "@/components/line-chart";
import { SectionTitle, LoadingRows, Delta } from "@/components/ui";
import { Abbr } from "@/components/abbr";
import { isStaff, useAuth } from "@/lib/auth-context";

interface Summary {
  activeSubscriptions: number;
  draftSubscriptions: number;
  revenuePaidCents: number;
  overdueInvoices: number;
  outstandingCents: number;
  customers: number;
  openInvoices: number;
  mrrCents: number;
  revenueSeries: { month: string; amount: number }[];
  outstandingList: {
    id: number;
    number: string;
    company_name: string;
    balance_due: string;
    due_date: string;
    is_overdue: boolean;
    days_overdue: number;
  }[];
}

export default function DashboardPage() {
  const { user } = useAuth();
  const { data, isLoading, error } = useQuery<Summary>({
    queryKey: ["summary"],
    queryFn: () => get<Summary>("/reports/summary"),
  });

  if (isLoading) {
    return (
      <>
        <SectionTitle title="Overview" />
        <LoadingRows rows={5} />
      </>
    );
  }
  if (error || !data) {
    return (
      <>
        <SectionTitle title="Overview" />
        <p className="text-muted">The API is not reachable right now — start it with `npm run dev -w apps/api`.</p>
      </>
    );
  }

  const series: SeriesPoint[] = data.revenueSeries.map((r) => ({
    label: r.month.slice(0, 7), // ISO timestamp -> "2026-09"
    value: r.amount,
  }));

  // KPI tabs drive the chart: cash collected per month is the default series;
  // the first tab pair swaps metric (cash / outstanding).
  return (
    <>
      <SectionTitle title={isStaff(user?.role) ? "Overview" : "My account"} />

      {/* balances first — one container split by hairlines into equal columns */}
      <div className="card grid grid-cols-4 divide-x divide-line">
        <BalanceCell label={<Abbr term="MRR" full="Monthly Recurring Revenue — every active subscription normalized to a monthly value" />} value={money(data.mrrCents)} note="recurring, normalized" />
        <BalanceCell label="Cash collected" value={money(data.revenuePaidCents)} note="all payments" />
        <BalanceCell
          label="Outstanding"
          value={money(data.outstandingCents)}
          note={data.outstandingCents === 0 ? "nothing owed" : `${data.openInvoices} confirmed invoices`}
          zero={data.outstandingCents === 0}
        />
        <BalanceCell
          label="Overdue"
          value={String(data.overdueInvoices)}
          note={data.overdueInvoices === 0 ? "all invoices on time" : "need attention"}
          zero={data.overdueInvoices === 0}
        />
      </div>

      {/* main chart card: KPIs as the chart's tabs */}
      <div className="card mt-3 p-6">
        <div className="flex items-baseline justify-between">
          <h2 className="text-[16px] font-medium">Collected monthly</h2>
          {series.length >= 2 && (
            <ComparisonLine series={series} />
          )}
        </div>
        <div className="mt-4">
          <LineChart
            series={series}
            hue="#1d5fbf"
            height={220}
            format={(v) => money(v)}
            formatTick={(v) => {
              const k = Math.abs(v) / 100000;
              return `₹${k >= 10 ? k.toFixed(0) : k.toFixed(1)}L`;
            }}
            ariaLabel="Cash collected per month"
          />
        </div>
        <p className="text-xs text-faint mt-3">
          {series.length
            ? `${series.length} months of real payments, ${money(Math.max(...series.map((s) => s.value)))} best month`
            : "No payments recorded yet."}
        </p>
      </div>

      {/* paired cards: outstanding table + subscription counts */}
      <div className="grid grid-cols-2 gap-3 mt-3">
        <div className="card">
          <div className="px-6 py-4 flex items-center justify-between" style={{ borderBottom: "1px solid var(--color-rule)" }}>
            <h2 className="text-[16px] font-medium">Outstanding invoices</h2>
            <Link href="/invoices" className="text-sm text-muted hover:text-ink">
              All invoices →
            </Link>
          </div>
          {data.outstandingList.length === 0 ? (
            <p className="text-sm text-muted px-6 py-8">
              Every confirmed invoice is settled. Nice.
            </p>
          ) : (
            <table className="btable">
              <thead>
                <tr>
                  <th>Invoice</th>
                  <th>Customer</th>
                  <th>Due</th>
                  <th className="num">Balance</th>
                </tr>
              </thead>
              <tbody>
                {data.outstandingList.slice(0, 6).map((r) => (
                  <tr key={r.id}>
                    <td>
                      <Link href={`/invoices/${r.id}`} className="mono-id text-ink hover:underline font-mono">
                        {r.number}
                      </Link>
                    </td>
                    <td>{r.company_name}</td>
                    <td>
                      <span className={r.is_overdue ? "text-negative" : ""}>
                        {r.is_overdue ? dueLabel(r.due_date) : dateShort(r.due_date)}
                      </span>
                    </td>
                    <td className="num money">{money(Number(r.balance_due))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="card">
          <div className="px-6 py-4 flex items-center justify-between" style={{ borderBottom: "1px solid var(--color-rule)" }}>
            <h2 className="text-[16px] font-medium">Subscriptions</h2>
            <Link href="/subscriptions" className="text-sm text-muted hover:text-ink">
              Pipeline →
            </Link>
          </div>
          <div className="grid grid-cols-3 divide-x divide-line">
            <CountCell value={data.activeSubscriptions} label="active" />
            <CountCell value={data.draftSubscriptions} label="drafts" />
            <CountCell value={data.customers} label="customers" />
          </div>
          <div className="px-6 py-4 text-sm text-muted">
            {data.activeSubscriptions === 0
              ? "No active subscriptions yet — create one from a plan to start billing."
              : `MRR ${money(data.mrrCents)} across ${data.activeSubscriptions} active subscription${data.activeSubscriptions === 1 ? "" : "s"}.`}
          </div>
        </div>
      </div>
    </>
  );
}

function BalanceCell({
  label,
  value,
  note,
  zero,
}: {
  label: React.ReactNode;
  value: string;
  note: string;
  zero?: boolean;
}) {
  return (
    <div className="px-6 py-5">
      <p className="text-muted text-[13px]">{label}</p>
      <p className={`text-[30px] leading-tight mt-1.5 ${zero ? "text-faint" : "money"}`}>{value}</p>
      <p className={`text-xs mt-1 ${zero ? "text-muted" : "text-faint"}`}>{note}</p>
    </div>
  );
}

function CountCell({ value, label }: { value: number; label: string }) {
  return (
    <div className="px-6 py-5 text-center">
      <p className="text-[30px] leading-tight money">{value}</p>
      <p className="text-xs text-faint mt-1">{label}</p>
    </div>
  );
}

function ComparisonLine({ series }: { series: SeriesPoint[] }) {
  // small "vs previous month" signal — the only hue in the header row
  const last = series[series.length - 1]!.value;
  const prev = series[series.length - 2]!.value;
  const change = prev === 0 ? (last > 0 ? 100 : 0) : ((last - prev) / prev) * 100;
  return (
    <span className="text-xs text-faint">
      vs prior month <Delta value={change} />
    </span>
  );
}

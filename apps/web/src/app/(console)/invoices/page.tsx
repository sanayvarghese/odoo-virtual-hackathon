"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { get, qs } from "@/lib/api";
import { money, dateShort, dueLabel } from "@/lib/format";
import { SectionTitle, EmptyState, LoadingRows, StatusPill } from "@/components/ui";
import { useAuth } from "@/lib/auth-context";

interface InvoiceRow {
  id: number;
  number: string;
  status: string;
  issueDate: string;
  dueDate: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  total: number;
  paidTotal: number;
  customerName: string;
  subscriptionNumber: string | null;
}

const FILTERS: { label: string; value: string }[] = [
  { label: "All", value: "" },
  { label: "Draft", value: "draft" },
  { label: "Sent / unpaid", value: "sent,confirmed" },
  { label: "Paid", value: "paid" },
  { label: "Void", value: "void" },
];

export default function InvoicesPage() {
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const { user } = useAuth();
  const staff = user?.role !== "customer";

  const list = useQuery({
    queryKey: ["invoices", { q, status, page }],
    queryFn: () =>
      get<{ items: InvoiceRow[]; page: number; limit: number; total: number }>(
        `/invoices${qs({ q, status, page, limit: 15 })}`,
      ),
  });

  const filterEl = (
    <div className="flex gap-1.5">
      {FILTERS.map((f) => (
        <button
          key={f.label}
          onClick={() => {
            setStatus(f.value);
            setPage(1);
          }}
          className="btn"
          style={
            status === f.value
              ? { background: "#e9e9e9", color: "#0a0a0a", height: 28, padding: "0 10px" }
              : { background: "transparent", color: "#6b6b6b", height: 28, padding: "0 10px", border: "1px solid var(--color-line)" }
          }
        >
          {f.label}
        </button>
      ))}
    </div>
  );

  return (
    <>
      <SectionTitle title="Invoices" desc="Draft first, confirmed on issue, paid by payment." />

      <div className="flex items-center gap-3 mb-3">
        <input
          className="input max-w-[280px]"
          placeholder="Search INV number"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setPage(1);
          }}
        />
        {filterEl}
      </div>

      <div className="card">
        {list.isLoading ? (
          <LoadingRows rows={6} />
        ) : list.data && list.data.items.length === 0 ? (
          <EmptyState title="No invoices match" hint="Run a billing pass from Plans → Run billing to fan out drafts." />
        ) : (
          <table className="btable">
            <thead>
              <tr>
                <th>Invoice</th>
                <th>Customer</th>
                <th>Subscription</th>
                <th>Period</th>
                <th>Issued</th>
                <th>Due</th>
                <th>Status</th>
                <th className="num">Total</th>
                <th className="num">Balance</th>
              </tr>
            </thead>
            <tbody>
              {list.data?.items.map((inv) => {
                const balance = inv.total - inv.paidTotal;
                return (
                  <tr key={inv.id}>
                    <td>
                      <Link href={`/invoices/${inv.id}`} className="mono-id text-ink hover:underline">
                        {inv.number}
                      </Link>
                    </td>
                    <td>{inv.customerName}</td>
                    <td className="mono-id text-faint">{inv.subscriptionNumber ?? "—"}</td>
                    <td className="text-xs">
                      {inv.periodStart ? `${dateShort(inv.periodStart)} → ${dateShort(inv.periodEnd)}` : "—"}
                    </td>
                    <td className="text-xs">{dateShort(inv.issueDate)}</td>
                    <td className="text-xs">{dueLabel(inv.dueDate)}</td>
                    <td>
                      <StatusPill status={inv.status} />
                    </td>
                    <td className="num money">{money(inv.total)}</td>
                    <td className={`num ${balance === 0 ? "text-faint" : "money"}`}>
                      {balance === 0 ? "settled" : money(balance)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        {list.data && list.data.total > list.data.limit && (
          <div className="flex items-center justify-between px-6 py-3" style={{ borderTop: "1px solid var(--color-rule)" }}>
            <span className="text-xs text-faint">
              {list.data.total} invoices · page {list.data.page}
            </span>
            <div className="flex gap-2">
              <button className="btn btn-outline" style={{ height: 28 }} disabled={page <= 1} onClick={() => setPage(page - 1)}>
                Previous
              </button>
              <button
                className="btn btn-outline"
                style={{ height: 28 }}
                disabled={page * list.data.limit >= list.data.total}
                onClick={() => setPage(page + 1)}
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>
    </>
  );
}

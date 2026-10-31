"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { get, qs } from "@/lib/api";
import { money, dateTime } from "@/lib/format";
import { SectionTitle, EmptyState, LoadingRows } from "@/components/ui";
import { useAuth } from "@/lib/auth-context";

interface PaymentRow {
  id: number;
  invoiceId: number;
  invoiceNumber: string;
  invoiceTotal: number;
  customerName: string;
  amount: number;
  method: string;
  paidAt: string;
  note: string | null;
}

export default function PaymentsPage() {
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  useAuth();

  const list = useQuery({
    queryKey: ["payments", { q, page }],
    queryFn: () =>
      get<{ items: PaymentRow[]; page: number; limit: number; total: number }>(
        `/payments${qs({ q, page, limit: 20 })}`,
      ),
  });

  return (
    <>
      <SectionTitle title="Payments" desc="Cash in, tied to invoices. Partials allowed; the balance follows." />

      <input
        className="input max-w-[280px] mb-3"
        placeholder="Search invoice number or company"
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setPage(1);
        }}
      />

      <div className="card">
        {list.isLoading ? (
          <LoadingRows rows={5} />
        ) : list.data && list.data.items.length === 0 ? (
          <EmptyState title="No payments yet" hint="Record one from any unpaid invoice's detail page." />
        ) : (
          <table className="btable">
            <thead>
              <tr>
                <th>Paid at</th>
                <th>Invoice</th>
                <th>Customer</th>
                <th>Method</th>
                <th>Note</th>
                <th className="num">Amount</th>
              </tr>
            </thead>
            <tbody>
              {list.data?.items.map((p) => (
                <tr key={p.id}>
                  <td className="text-xs">{dateTime(p.paidAt)}</td>
                  <td>
                    <Link href={`/invoices/${p.invoiceId}`} className="mono-id text-ink hover:underline">
                      {p.invoiceNumber}
                    </Link>
                  </td>
                  <td>{p.customerName}</td>
                  <td className="capitalize">{p.method.replace(/_/g, " ")}</td>
                  <td className="text-muted text-xs max-w-[200px] truncate">{p.note ?? "—"}</td>
                  <td className="num money">{money(p.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {list.data && list.data.total > list.data.limit && (
          <div className="flex items-center justify-between px-6 py-3" style={{ borderTop: "1px solid var(--color-rule)" }}>
            <span className="text-xs text-faint">
              {list.data.total} payments · page {list.data.page}
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

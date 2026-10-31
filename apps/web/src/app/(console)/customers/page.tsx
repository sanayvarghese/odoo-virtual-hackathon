"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { get, qs } from "@/lib/api";
import { dateShort } from "@/lib/format";
import { SectionTitle, EmptyState, LoadingRows, StatusPill } from "@/components/ui";

interface CustomerRow {
  id: number;
  companyName: string;
  contactName: string;
  email: string;
  phone: string | null;
  isActive: boolean;
  createdAt: string;
}

export default function CustomersPage() {
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);

  const list = useQuery({
    queryKey: ["customers", { q, page }],
    queryFn: () =>
      get<{ items: CustomerRow[]; page: number; limit: number; total: number }>(
        `/customers${qs({ q, page, limit: 15 })}`,
      ),
  });

  return (
    <>
      <SectionTitle title="Customers" desc="Companies with a portal login. Every subscription belongs to one." />

      <input
        className="input max-w-[320px] mb-3"
        placeholder="Search company, contact or email"
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
          <EmptyState title="No customers found" hint="Customers sign up from the website — or come in through a bulk import." />
        ) : (
          <table className="btable">
            <thead>
              <tr>
                <th>Company</th>
                <th>Contact</th>
                <th>Email</th>
                <th>Phone</th>
                <th>Since</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {list.data?.items.map((c) => (
                <tr key={c.id}>
                  <td>{c.companyName}</td>
                  <td>{c.contactName}</td>
                  <td className="text-muted">{c.email}</td>
                  <td className="text-muted">{c.phone ?? "—"}</td>
                  <td className="text-xs">{dateShort(c.createdAt)}</td>
                  <td>
                    <StatusPill status={c.isActive ? "enabled" : "disabled"} />
                  </td>
                  <td className="text-right">
                    <Link href={`/subscriptions?customerId=${c.id}`} className="text-sm text-muted hover:text-ink">
                      Subscriptions →
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}

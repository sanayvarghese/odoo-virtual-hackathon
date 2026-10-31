"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { get, qs } from "@/lib/api";
import { money, dateShort } from "@/lib/format";
import { SectionTitle, EmptyState, LoadingRows } from "@/components/ui";
import { Modal } from "@/components/modal";
import { useToast } from "@/components/toast";

interface SubRow {
  id: number;
  number: string;
  status: string;
  quantity: number;
  startDate: string;
  expiryDate: string | null;
  nextBillingDate: string | null;
  paymentTerms: string;
  autoRenew: boolean;
  customerName: string;
  planName: string;
  planInterval: string;
}

const COLUMNS = [
  { id: "draft", label: "Draft" },
  { id: "quotation", label: "Quotation" },
  { id: "confirmed", label: "Confirmed" },
  { id: "active", label: "Active" },
  { id: "closed", label: "Closed" },
  { id: "cancelled", label: "Cancelled" },
];

export default function SubscriptionsPage() {
  const [q, setQ] = useState("");

  const list = useQuery({
    queryKey: ["subscriptions", { q }],
    queryFn: () => get<{ items: SubRow[]; total: number }>(`/subscriptions${qs({ q, limit: 300 })}`),
  });

  const byStatus = new Map<string, SubRow[]>();
  for (const col of COLUMNS) byStatus.set(col.id, []);
  for (const item of list.data?.items ?? []) {
    const key = item.status === "past_due" ? "active" : item.status === "paused" || item.status === "cancel_requested" ? "active" : item.status;
    // paused/cancel_requested stay visible under Active with their own pill inside the card
    byStatus.get(item.status === "past_due" || item.status === "paused" || item.status === "cancel_requested" ? "active" : item.status)
      ?.push(item);
  }

  return (
    <>
      <SectionTitle title="Subscriptions" desc="Draft → quotation → confirmed → active → closed. Nothing jumps a state." />
      <div className="relative mb-3 max-w-[320px]">
        <input
          className="input"
          placeholder="Search by SUB number or company"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>

      {list.isLoading ? (
        <LoadingRows rows={5} />
      ) : list.error ? (
        <p className="text-muted">Could not load subscriptions — is the API running?</p>
      ) : list.data && list.data.items.length === 0 ? (
        <div className="card">
          <EmptyState title="No subscriptions yet" hint="Create one from the Plans page — a draft starts the pipeline." />
        </div>
      ) : (
        <div className="flex gap-3 overflow-x-auto pb-2">
          {COLUMNS.map((col) => {
            const rows = byStatus.get(col.id) ?? [];
            return (
              <div key={col.id} className="card shrink-0 w-[240px] flex flex-col" style={{ background: "var(--color-surface)" }}>
                <div className="px-3 py-2.5 flex items-baseline justify-between" style={{ borderBottom: "1px solid var(--color-rule)" }}>
                  <span className="text-[13px] font-medium">{col.label}</span>
                  <span className="text-xs text-faint money">{rows.length}</span>
                </div>
                <div className="flex-1 overflow-y-auto" style={{ maxHeight: 480 }}>
                  {rows.length === 0 ? (
                    <p className="text-xs text-faint px-3 py-4">Empty</p>
                  ) : (
                    rows.map((r) => (
                      <Link
                        key={r.id}
                        href={`/subscriptions/${r.id}`}
                        className="block px-3 py-2.5 hover:bg-[#fafafa]"
                        style={{ borderBottom: "1px solid var(--color-rule)" }}
                      >
                        <div className="flex items-baseline justify-between gap-2">
                          <span className="mono-id">{r.number}</span>
                          {r.status !== col.id && (
                            <span className="pill pill-warning" style={{ height: 16, fontSize: 10 }}>{r.status.replace(/_/g, " ")}</span>
                          )}
                        </div>
                        <p className="text-sm mt-1 truncate">{r.customerName}</p>
                        <p className="text-xs text-muted truncate">
                          {r.planName} · {r.planInterval}
                        </p>
                        <p className="text-xs text-faint mt-0.5">
                          {r.nextBillingDate ? `next bill ${dateShort(r.nextBillingDate)}` : `start ${dateShort(r.startDate)}`}
                        </p>
                      </Link>
                    ))
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}

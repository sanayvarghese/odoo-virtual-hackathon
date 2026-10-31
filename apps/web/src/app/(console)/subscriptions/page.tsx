"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { Plus } from "lucide-react";
import { get, post, qs, ApiError } from "@/lib/api";
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
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState({
    customerId: "",
    planId: "",
    quantity: "1",
    startDate: new Date().toISOString().slice(0, 10),
    paymentTerms: "net15",
    autoRenew: true,
    notes: "",
  });
  const [createError, setCreateError] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const list = useQuery({
    queryKey: ["subscriptions", { q }],
    queryFn: () => get<{ items: SubRow[]; total: number }>(`/subscriptions${qs({ q, limit: 300 })}`),
  });

  const customers = useQuery({
    queryKey: ["customer-options"],
    queryFn: () => get<{ items: { id: number; companyName: string }[] }>("/customers?limit=200"),
  });
  const plans = useQuery({
    queryKey: ["plan-options"],
    queryFn: () => get<{ items: { id: number; name: string; interval: string; price: number; minQty: number; isActive: boolean }[] }>("/plans"),
  });

  const create = useMutation({
    mutationFn: () =>
      post<{ subscription: { id: number; number: string } }>("/subscriptions", {
        customerId: Number(form.customerId),
        planId: Number(form.planId),
        quantity: Math.max(1, Number(form.quantity) || 1),
        startDate: form.startDate,
        paymentTerms: form.paymentTerms,
        autoRenew: form.autoRenew,
        notes: form.notes.trim() || undefined,
      }),
    onSuccess: (r) => {
      toast("success", `${r.subscription.number} created as a draft`);
      setCreateOpen(false);
      setCreateError(null);
      void queryClient.invalidateQueries({ queryKey: ["subscriptions"] });
    },
    onError: (e) => setCreateError(e instanceof ApiError ? e.message : "Could not create the subscription"),
  });

  const chosenPlan = plans.data?.items.find((p) => p.id === Number(form.planId));

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
      <SectionTitle
        title="Subscriptions"
        desc="Draft → quotation → confirmed → active → closed. Nothing jumps a state."
        action={
          <button className="btn btn-primary" onClick={() => setCreateOpen(true)}>
            <Plus size={15} /> New subscription
          </button>
        }
      />
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

      {createOpen && (
        <Modal
          title="New subscription"
          desc="Starts as a draft — the lifecycle begins when you send or confirm it."
          width={560}
          onClose={() => {
            setCreateOpen(false);
            setCreateError(null);
          }}
        >
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              create.mutate();
            }}
          >
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="field-label" htmlFor="sub-customer">
                  Customer
                </label>
                <select
                  id="sub-customer"
                  className="select"
                  value={form.customerId}
                  onChange={(e) => setForm({ ...form, customerId: e.target.value })}
                  required
                >
                  <option value="">Choose…</option>
                  {(customers.data?.items ?? []).map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.companyName}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="field-label" htmlFor="sub-plan">
                  Plan
                </label>
                <select
                  id="sub-plan"
                  className="select"
                  value={form.planId}
                  onChange={(e) => setForm({ ...form, planId: e.target.value })}
                  required
                >
                  <option value="">Choose…</option>
                  {(plans.data?.items ?? [])
                    .filter((p) => p.isActive)
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} ({p.interval})
                      </option>
                    ))}
                </select>
              </div>
            </div>

            {chosenPlan && (
              <p className="text-sm text-muted">
                {money(chosenPlan.price)} per {chosenPlan.interval} period, minimum {chosenPlan.minQty} seat
                {chosenPlan.minQty === 1 ? "" : "s"}.
              </p>
            )}

            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="field-label" htmlFor="sub-qty">
                  Quantity
                </label>
                <input
                  id="sub-qty"
                  type="number"
                  min={chosenPlan?.minQty ?? 1}
                  className="input tnum"
                  value={form.quantity}
                  onChange={(e) => setForm({ ...form, quantity: e.target.value })}
                  required
                />
              </div>
              <div>
                <label className="field-label" htmlFor="sub-date">
                  Start date
                </label>
                <input
                  id="sub-date"
                  type="date"
                  className="input"
                  value={form.startDate}
                  onChange={(e) => setForm({ ...form, startDate: e.target.value })}
                  required
                />
              </div>
              <div>
                <label className="field-label" htmlFor="sub-terms">
                  Payment terms
                </label>
                <select
                  id="sub-terms"
                  className="select"
                  value={form.paymentTerms}
                  onChange={(e) => setForm({ ...form, paymentTerms: e.target.value })}
                >
                  <option value="immediate">Immediate</option>
                  <option value="net15">Net 15</option>
                  <option value="net30">Net 30</option>
                  <option value="net45">Net 45</option>
                </select>
              </div>
            </div>

            <div>
              <label className="field-label" htmlFor="sub-notes">
                Notes <span className="text-faint font-normal">optional</span>
              </label>
              <input
                id="sub-notes"
                className="input"
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
              />
            </div>

            <label className="flex items-center gap-2 text-sm" htmlFor="sub-renew">
              <input
                id="sub-renew"
                type="checkbox"
                checked={form.autoRenew}
                onChange={(e) => setForm({ ...form, autoRenew: e.target.checked })}
              />
              Auto-renew each period
            </label>

            {createError && (
              <p className="text-sm text-negative" role="alert">
                {createError}
              </p>
            )}

            <div className="flex justify-end gap-2">
              <button type="button" className="btn btn-outline" onClick={() => setCreateOpen(false)}>
                Cancel
              </button>
              <button type="submit" className="btn btn-primary" disabled={create.isPending}>
                {create.isPending ? "Creating…" : "Create draft"}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}

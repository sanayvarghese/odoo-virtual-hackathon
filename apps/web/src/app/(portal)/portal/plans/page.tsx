"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { get, post, ApiError } from "@/lib/api";
import { money, dateShort } from "@/lib/format";
import { SectionTitle, EmptyState, LoadingRows } from "@/components/ui";
import { Modal } from "@/components/modal";
import { useToast } from "@/components/toast";

interface Plan {
  id: number;
  name: string;
  description: string | null;
  productName: string;
  productSku: string;
  interval: string;
  price: number;
  minQty: number;
  validTo: string | null;
  allowPause: boolean;
  allowEarlyCancel: boolean;
  autoRenew: boolean;
  autoCloseAtEnd: boolean;
}

export default function PortalPlansPage() {
  const [subscribing, setSubscribing] = useState<Plan | null>(null);
  const [form, setForm] = useState({ quantity: "", startDate: new Date().toISOString().slice(0, 10), notes: "", autoRenew: true });
  const [error, setError] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const plans = useQuery({
    queryKey: ["available-plans"],
    queryFn: () => get<{ items: Plan[] }>("/plans?availableOnly=true"),
  });

  const subscribe = useMutation({
    mutationFn: () =>
      post<{ subscription: { id: number; number: string; status: string } }>("/subscriptions/self", {
        planId: subscribing!.id,
        quantity: Math.max(subscribing!.minQty, Number(form.quantity) || 1),
        startDate: form.startDate || undefined,
        autoRenew: form.autoRenew,
        notes: form.notes.trim() || undefined,
      }),
    onSuccess: (r) => {
      toast("success", `${r.subscription.number} requested — our team confirms it shortly.`);
      setSubscribing(null);
      setError(null);
      void queryClient.invalidateQueries({ queryKey: ["portal-subs"] });
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : "Could not subscribe"),
  });

  function openSubscribe(p: Plan) {
    setForm({ quantity: String(p.minQty), startDate: new Date().toISOString().slice(0, 10), notes: "", autoRenew: p.autoRenew });
    setSubscribing(p);
    setError(null);
  }

  return (
    <>
      <SectionTitle
        title="Browse plans"
        desc="Everything the admin published, live from the workspace. Subscribing raises a request our team confirms."
      />

      {plans.isLoading ? (
        <div className="grid grid-cols-2 gap-3">
          <LoadingRows rows={3} />
          <LoadingRows rows={3} />
        </div>
      ) : plans.data && plans.data.items.length === 0 ? (
        <div className="card">
          <EmptyState title="No plans are open for subscription right now" hint="Check back soon, or contact the team." />
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          {plans.data?.items.map((p) => (
            <div key={p.id} className="card p-6 flex flex-col">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-xs text-faint mono-id">{p.productSku}</p>
                  <h2 className="text-[16px] font-medium mt-0.5">{p.name}</h2>
                  <p className="text-xs text-muted">{p.productName}</p>
                </div>
                <span className="pill pill-neutral capitalize">{p.interval}</span>
              </div>

              {p.description && <p className="text-sm text-muted mt-3 leading-relaxed flex-1">{p.description}</p>}

              <div className="mt-4 flex items-baseline gap-1.5">
                <span className="text-[30px] money">{money(p.price)}</span>
                <span className="text-sm text-muted">
                  /{p.interval === "daily" ? "day" : p.interval === "weekly" ? "week" : p.interval === "yearly" ? "year" : "month"}
                </span>
              </div>
              {p.minQty > 1 && <p className="text-xs text-faint mt-1">minimum {p.minQty} seats</p>}

              <ul className="mt-4 space-y-1 text-sm">
                <Feature on={p.autoRenew} label="renews automatically" />
                <Feature on={p.allowPause} label="can be paused" />
                <Feature on={p.allowEarlyCancel} label="can be cancelled early" />
                <Feature on={p.autoCloseAtEnd} label="closes itself at end date" />
              </ul>

              <div className="flex items-center justify-between mt-5">
                <p className="text-xs text-faint">Available until {p.validTo ? dateShort(p.validTo) : "onward"}</p>
                <button className="btn btn-primary" onClick={() => openSubscribe(p)}>
                  Subscribe
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {subscribing && (
        <Modal
          title={`Subscribe to ${subscribing.name}`}
          desc="This creates a draft subscription — billing only starts after our team confirms it."
          width={480}
          onClose={() => {
            setSubscribing(null);
            setError(null);
          }}
        >
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              subscribe.mutate();
            }}
          >
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="field-label" htmlFor="sb-qty">
                  Seats / quantity (min {subscribing.minQty})
                </label>
                <input
                  id="sb-qty"
                  type="number"
                  min={subscribing.minQty}
                  className="input tnum"
                  value={form.quantity}
                  onChange={(e) => setForm({ ...form, quantity: e.target.value })}
                  required
                />
              </div>
              <div>
                <label className="field-label" htmlFor="sb-date">
                  Start date
                </label>
                <input
                  id="sb-date"
                  type="date"
                  className="input"
                  value={form.startDate}
                  onChange={(e) => setForm({ ...form, startDate: e.target.value })}
                  required
                />
              </div>
            </div>
            <div>
              <label className="field-label" htmlFor="sb-notes">
                Note to the team <span className="text-faint font-normal">optional</span>
              </label>
              <input
                id="sb-notes"
                className="input"
                placeholder="e.g. Starting with the support team"
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
              />
            </div>
            {subscribing.autoRenew && (
              <label className="flex items-center gap-2 text-sm" htmlFor="sb-renew">
                <input
                  id="sb-renew"
                  type="checkbox"
                  checked={form.autoRenew}
                  onChange={(e) => setForm({ ...form, autoRenew: e.target.checked })}
                />
                Auto-renew each period
              </label>
            )}
            <p className="text-sm text-muted">
              {money(subscribing.price)} per {subscribing.interval} period, billed after confirmation.
            </p>
            {error && (
              <p className="text-sm text-negative" role="alert">
                {error}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <button type="button" className="btn btn-outline" onClick={() => setSubscribing(null)}>
                Cancel
              </button>
              <button type="submit" className="btn btn-primary" disabled={subscribe.isPending}>
                {subscribe.isPending ? "Requesting…" : "Request subscription"}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}

function Feature({ on, label }: { on: boolean; label: string }) {
  return (
    <li className={`flex items-center gap-2 ${on ? "" : "text-faint"}`}>
      <span className="inline-block w-3">{on ? "✓" : "—"}</span>
      {label}
    </li>
  );
}


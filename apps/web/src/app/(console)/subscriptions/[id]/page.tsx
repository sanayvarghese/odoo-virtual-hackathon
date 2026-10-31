"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { get, post, ApiError } from "@/lib/api";
import { money, dateShort, dateTime, pct } from "@/lib/format";
import { StatusPill, LoadingRows } from "@/components/ui";
import { useToast } from "@/components/toast";
import { useAuth, isStaff } from "@/lib/auth-context";

/**
 * FSM client-side copy — mirrors the service so invalid transitions render as
 * disabled rather than being attempted (server still 409s them).
 */
const ALLOWED: Record<string, string[]> = {
  draft: ["quotation", "cancelled"],
  quotation: ["confirmed", "cancelled"],
  confirmed: ["active", "cancelled"],
  active: ["paused", "closed", "cancelled"],
  paused: ["active", "closed", "cancelled"],
  closed: [],
  cancelled: [],
};

const TRANSITION_LABEL: Record<string, string> = {
  quotation: "Send as quotation",
  confirmed: "Confirm",
  active: "Activate",
  paused: "Pause",
  closed: "Close",
  cancelled: "Cancel",
};

interface SubFull {
  id: number;
  number: string;
  status: string;
  quantity: number;
  startDate: string;
  expiryDate: string | null;
  nextBillingDate: string | null;
  paymentTerms: string;
  autoRenew: boolean;
  notes: string | null;
  plan: { id: number; name: string; interval: string; price: number; minQty: number; allowPause: boolean; allowEarlyCancel: boolean; autoRenew: boolean; autoCloseAtEnd: boolean } | null;
  customer: { id: number; companyName: string; contactName: string } | null;
  lines: {
    id: number;
    productName: string;
    productSku: string;
    variantName: string | null;
    variantDelta: number | null;
    quantity: number;
    unitPrice: number;
    taxRuleIds: number[];
  }[];
  discounts: { id: number; name: string; kind: string; percentOff: number | null; amountOffCents: number | null }[];
  events: { id: number; type: string; message: string | null; fromStatus: string | null; toStatus: string | null; actorId: number | null; at: string }[];
}

export default function SubscriptionDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { user } = useAuth();
  const staff = isStaff(user?.role);

  const detail = useQuery({
    queryKey: ["subscription", id],
    queryFn: () => get<{ subscription: SubFull }>(`/subscriptions/${id}`),
  });

  const transition = useMutation({
    mutationFn: (to: string) => post(`/subscriptions/${id}/transition`, { to }),
    onSuccess: (_r, to) => {
      toast("success", `Moved to ${TRANSITION_LABEL[to]?.toLowerCase() ?? to}`);
      void queryClient.invalidateQueries({ queryKey: ["subscription", id] });
      void queryClient.invalidateQueries({ queryKey: ["subscriptions"] });
    },
    onError: (e) => toast("error", e instanceof ApiError ? e.message : "Transition failed"),
  });

  if (detail.isLoading) {
    return <LoadingRows rows={6} />;
  }
  if (detail.error || !detail.data) {
    return (
      <>
        <p className="text-muted mt-4">This subscription could not be loaded.</p>
        <Link href="/subscriptions" className="btn btn-outline mt-3">
          Back to pipeline
        </Link>
      </>
    );
  }

  const sub = detail.data.subscription;
  const plan = sub.plan;
  const linesTotal = sub.lines.reduce((acc, l) => acc + l.quantity * l.unitPrice, 0);
  const notAllowed = !ALLOWED[sub.status]?.length;

  return (
    <>
      <Link href="/subscriptions" className="text-sm text-muted hover:text-ink">
        ← Pipeline
      </Link>
      <div className="flex items-start justify-between mt-3 mb-6">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-[24px] font-medium leading-tight">{sub.number}</h1>
            <StatusPill status={sub.status} />
          </div>
          <p className="text-muted mt-1">
            {sub.customer?.companyName} · {plan?.name}
          </p>
        </div>
        {staff && !notAllowed && (
          <div className="flex gap-2">
            {ALLOWED[sub.status]!.map((to) => {
              const dangerous = to === "cancelled";
              const blocked =
                (to === "paused" && !plan?.allowPause) ||
                (to === "cancelled" && !plan?.allowEarlyCancel);
              return (
                <button
                  key={to}
                  className={`btn ${dangerous ? "btn-danger" : "btn-primary"}`}
                  disabled={blocked || transition.isPending}
                  title={blocked ? `Plan does not allow ${to}` : undefined}
                  onClick={() => transition.mutate(to)}
                >
                  {TRANSITION_LABEL[to]}
                </button>
              );
            })}
          </div>
        )}
      </div>

      <div className="grid grid-cols-4 gap-3">
        <DetailCard label="Billing interval" value={plan?.interval ? plan.interval : "—"} />
        <DetailCard label="Plan price" value={plan ? money(plan.price) : "—"} />
        <DetailCard label="Quantity" value={String(sub.quantity)} note={`min ${plan?.minQty ?? 1}`} />
        <DetailCard label="Next billing" value={sub.nextBillingDate ? dateShort(sub.nextBillingDate) : "—"} note={sub.expiryDate ? `runs to ${dateShort(sub.expiryDate)}` : "open ended"} />
      </div>

      <div className="grid grid-cols-2 gap-3 mt-3">
        <div className="card">
          <div className="px-6 py-4" style={{ borderBottom: "1px solid var(--color-rule)" }}>
            <h2 className="text-[16px] font-medium">Lines</h2>
          </div>
          {sub.lines.length === 0 ? (
            <p className="text-sm text-muted px-6 py-8">Plan-price billing — no extra lines overriden.</p>
          ) : (
            <table className="btable">
              <thead>
                <tr>
                  <th>Product</th>
                  <th className="num">Qty</th>
                  <th className="num">Unit price</th>
                </tr>
              </thead>
              <tbody>
                {sub.lines.map((l) => (
                  <tr key={l.id}>
                    <td>
                      <span className="block">{l.productName}</span>
                      <span className="mono-id text-faint">
                        {l.productSku}
                        {l.variantName ? ` · ${l.variantName}` : ""}
                        {l.variantDelta ? ` (+${money(l.variantDelta)})` : ""}
                      </span>
                    </td>
                    <td className="num">{l.quantity}</td>
                    <td className="num money">{money(l.unitPrice)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {sub.discounts.length > 0 && (
            <div className="px-6 py-4 text-sm" style={{ borderTop: "1px solid var(--color-rule)" }}>
              <span className="text-faint text-xs block mb-1.5">Discounts</span>
              {sub.discounts.map((d) => (
                <span key={d.id} className="pill pill-neutral mr-2">
                  {d.name}
                  {d.percentOff ? ` · ${pct(d.percentOff)} off` : d.amountOffCents ? ` · ${money(d.amountOffCents)} off` : ""}
                </span>
              ))}
            </div>
          )}
        </div>

        <div className="card">
          <div className="px-6 py-4" style={{ borderBottom: "1px solid var(--color-rule)" }}>
            <h2 className="text-[16px] font-medium">Timeline</h2>
          </div>
          <ol className="px-6 py-4">
            {sub.events.map((ev) => (
              <li key={ev.id} className="flex gap-3 py-2">
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: "var(--color-control)" }} />
                <div className="min-w-0">
                  <p className="text-sm">
                    <span className="capitalize">{ev.type.replace(/_/g, " ")}</span>
                    {ev.fromStatus !== ev.toStatus && ev.toStatus && (
                      <span className="text-faint"> → {ev.toStatus.replace(/_/g, " ")}</span>
                    )}
                  </p>
                  {ev.message && <p className="text-xs text-muted mt-0.5">{ev.message}</p>}
                  <p className="text-xs text-faint">{dateTime(ev.at)}</p>
                </div>
              </li>
            ))}
            {sub.events.length === 0 && <p className="text-sm text-muted py-4">No events recorded.</p>}
          </ol>
        </div>
      </div>

      {plan && staff && (
        <div className="card mt-3 px-6 py-4 flex flex-wrap items-center gap-x-6 gap-y-1 text-sm">
          <span className="text-faint text-xs">Plan rules</span>
          <PlanFlag on={plan.allowPause} label="pausable" />
          <PlanFlag on={plan.allowEarlyCancel} label="early-cancellable" />
          <PlanFlag on={plan.autoRenew} label="auto-renews" />
          <PlanFlag on={plan.autoCloseAtEnd} label="closes at end" />
          <span className="text-faint ml-auto text-xs">per-line total {money(linesTotal)} before taxes & discounts</span>
        </div>
      )}
    </>
  );
}

function DetailCard({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="card px-6 py-4">
      <p className="text-muted text-[13px]">{label}</p>
      <p className="text-[20px] leading-tight mt-1 money">{value}</p>
      {note && <p className="text-xs text-faint mt-1">{note}</p>}
    </div>
  );
}

function PlanFlag({ on, label }: { on: boolean; label: string }) {
  return (
    <span className={`text-xs ${on ? "" : "text-faint line-through"}`}>
      {label}
    </span>
  );
}

"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { get, post, ApiError } from "@/lib/api";
import { money, dateShort } from "@/lib/format";
import { SectionTitle, EmptyState, LoadingRows, StatusPill } from "@/components/ui";
import { useToast } from "@/components/toast";

interface PortalSub {
  id: number;
  number: string;
  status: string;
  quantity: number;
  startDate: string;
  expiryDate: string | null;
  nextBillingDate: string | null;
  autoRenew: boolean;
  planName: string;
  planInterval: string;
  companyName: string;
}

interface SubFull {
  id: number;
  number: string;
  status: string;
  quantity: number;
  nextBillingDate: string | null;
  plan: { name: string; interval: string; price: number; allowPause: boolean; allowEarlyCancel: boolean; autoRenew: boolean } | null;
  lines: { id: number; productName: string; quantity: number; unitPrice: number }[];
  events: { id: number; type: string; at: string }[];
}

const ALLOWED: Record<string, string[]> = {
  draft: [],
  quotation: [],
  confirmed: [],
  active: ["paused", "closed", "cancelled"],
  paused: ["active", "closed", "cancelled"],
  closed: [],
  cancelled: [],
};

export default function PortalPage() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const list = useQuery({
    queryKey: ["portal-subs"],
    queryFn: () => get<{ items: PortalSub[] }>("/subscriptions?limit=50"),
  });

  const transition = useMutation({
    mutationFn: ({ id, to }: { id: number; to: string }) => post(`/subscriptions/${id}/transition`, { to }),
    onSuccess: (_r) => {
      toast("success", "Done — the change shows on both sides.");
      void queryClient.invalidateQueries({ queryKey: ["portal-subs"] });
      void queryClient.invalidateQueries({ queryKey: ["portal-sub"] });
    },
    onError: (e) => toast("error", e instanceof ApiError ? e.message : "That move was not allowed"),
  });

  return (
    <>
      <SectionTitle title="My subscriptions" desc="Pause, renew or cancel — only where your plan allows it." />

      {list.isLoading ? (
        <LoadingRows rows={3} />
      ) : list.data && list.data.items.length === 0 ? (
        <div className="card">
          <EmptyState
            title="No subscriptions yet"
            hint="Browse the plans and pick what fits — a request becomes a subscription once billed."
            action={<Link href="/portal/plans" className="btn btn-primary">Browse plans</Link>}
          />
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          {list.data?.items.map((s) => (
            <SubCard key={s.id} sub={s} onAction={(to) => transition.mutate({ id: s.id, to })} busy={transition.isPending} />
          ))}
        </div>
      )}
    </>
  );
}

function SubCard({ sub, onAction, busy }: { sub: PortalSub; onAction: (to: string) => void; busy: boolean }) {
  const detail = useQuery({
    queryKey: ["portal-sub", sub.id],
    queryFn: () => get<{ subscription: SubFull }>(`/subscriptions/${sub.id}`),
  });

  const plan = detail.data?.subscription.plan;
  const actions = ALLOWED[sub.status] ?? [];
  const canPause = plan?.allowPause !== false;
  const canCancel = plan?.allowEarlyCancel !== false;

  return (
    <div className="card p-6" style={sub.status === "paused" ? {} : undefined}>
      <div className="flex items-start justify-between mb-4">
        <div>
          <span className="mono-id text-faint">{sub.number}</span>
          <h2 className="text-[16px] font-medium mt-1">{sub.planName}</h2>
          <p className="text-xs text-muted capitalize">
            {sub.planInterval} · qty {sub.quantity}
          </p>
        </div>
        <StatusPill status={sub.status} />
      </div>

      <div className="text-sm text-muted space-y-1">
        <p>
          Next billing <span className="text-ink">{sub.nextBillingDate ? dateShort(sub.nextBillingDate) : "—"}</span>
        </p>
        <p>
          Runs until <span className="text-ink">{sub.expiryDate ? dateShort(sub.expiryDate) : "open ended"}</span>
        </p>
        <p>
          Auto-renew <span className="text-ink">{sub.autoRenew ? "on" : "off"}</span>
        </p>
      </div>

      <div className="flex gap-2 mt-5">
        {actions.includes("paused") && canPause && (
          <button className="btn btn-outline" disabled={busy} onClick={() => onAction("paused")}>
            Pause
          </button>
        )}
        {actions.includes("active") && sub.status === "paused" && canPause && (
          <button className="btn btn-primary" disabled={busy} onClick={() => onAction("active")}>
            Resume
          </button>
        )}
        {actions.includes("cancelled") && canCancel && (
          <button className="btn btn-danger" disabled={busy} onClick={() => onAction("cancelled")}>
            Cancel subscription
          </button>
        )}
        {sub.status !== "active" && sub.status !== "paused" && (
          <span className="text-xs text-faint self-center">No self-service actions while {sub.status.replace(/_/g, " ")}</span>
        )}
      </div>
      {plan && !plan.allowPause && sub.status === "active" && (
        <p className="text-xs text-faint mt-2">This plan cannot be paused — it renews until it ends.</p>
      )}
    </div>
  );
}

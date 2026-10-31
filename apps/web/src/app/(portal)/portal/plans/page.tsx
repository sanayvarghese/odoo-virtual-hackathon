"use client";

import { useQuery } from "@tanstack/react-query";
import { get } from "@/lib/api";
import { money, dateShort } from "@/lib/format";
import { SectionTitle, EmptyState, LoadingRows } from "@/components/ui";

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
  const plans = useQuery({
    queryKey: ["available-plans"],
    queryFn: () => get<{ items: Plan[] }>("/plans?availableOnly=true"),
  });

  return (
    <>
      <SectionTitle title="Browse plans" desc="What you can subscribe to right now, with the rules each plan enforces." />

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

              {p.description && <p className="text-sm text-muted mt-3 leading-relaxed">{p.description}</p>}

              <div className="mt-4 flex items-baseline gap-1.5">
                <span className="text-[30px] money">{money(p.price)}</span>
                <span className="text-sm text-muted">/{p.interval === "daily" ? "day" : p.interval === "weekly" ? "week" : p.interval === "yearly" ? "year" : "month"}</span>
              </div>
              {p.minQty > 1 && <p className="text-xs text-faint mt-1">minimum {p.minQty} seats</p>}

              <ul className="mt-4 space-y-1 text-sm">
                <Feature on={p.autoRenew} label="renews automatically" />
                <Feature on={p.allowPause} label="can be paused" />
                <Feature on={p.allowEarlyCancel} label="can be cancelled early" />
                <Feature on={p.autoCloseAtEnd} label="closes itself at end date" />
              </ul>
              <p className="text-xs text-faint mt-4">
                Available until {p.validTo ? dateShort(p.validTo) : "onward"}
              </p>
            </div>
          ))}
        </div>
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

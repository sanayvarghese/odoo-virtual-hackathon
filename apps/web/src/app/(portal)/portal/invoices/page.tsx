"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { get, post, qs, ApiError } from "@/lib/api";
import { money, dateShort, dueLabel } from "@/lib/format";
import { SectionTitle, EmptyState, LoadingRows, StatusPill } from "@/components/ui";
import { useToast } from "@/components/toast";

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

/** Portal invoices: read-only list + pay-now mock checkout (server-validated). */
export default function PortalInvoicesPage() {
  const [paying, setPaying] = useState<InvoiceRow | null>(null);
  const [mode, setMode] = useState<"full" | "partial">("full");
  const [partial, setPartial] = useState("");
  const [method, setMethod] = useState("mock_wallet");
  const [error, setError] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const list = useQuery({
    queryKey: ["portal-invoices"],
    queryFn: () => get<{ items: InvoiceRow[]; total: number }>(`/invoices${qs({ limit: 50 })}`),
  });

  const payable = (inv: InvoiceRow) =>
    ["confirmed", "sent", "partially_paid"].includes(inv.status) && inv.total - inv.paidTotal > 0;

  const pay = useMutation({
    mutationFn: () => {
      if (!paying) throw new Error("no invoice");
      const balance = paying.total - paying.paidTotal;
      const amount = mode === "full" ? balance : Math.round(Number(partial) * 100);
      return post("/payments", { invoiceId: paying.id, amount, method });
    },
    onSuccess: () => {
      toast("success", "Payment recorded — thank you.");
      setPaying(null);
      setError(null);
      void queryClient.invalidateQueries({ queryKey: ["portal-invoices"] });
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : "Payment failed"),
  });

  return (
    <>
      <SectionTitle title="Invoices & payments" desc="Everything billed to your company, with one-click payment." />

      <div className="card">
        {list.isLoading ? (
          <LoadingRows rows={4} />
        ) : list.data && list.data.items.length === 0 ? (
          <EmptyState title="No invoices yet" />
        ) : (
          <table className="btable">
            <thead>
              <tr>
                <th>Invoice</th>
                <th>Period</th>
                <th>Issued</th>
                <th>Due</th>
                <th>Status</th>
                <th className="num">Total</th>
                <th className="num">Balance</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {list.data?.items.map((inv) => {
                const balance = inv.total - inv.paidTotal;
                return (
                  <tr key={inv.id}>
                    <td><span className="mono-id text-ink">{inv.number}</span></td>
                    <td className="text-xs">{inv.periodStart ? `${dateShort(inv.periodStart)} → ${dateShort(inv.periodEnd)}` : "—"}</td>
                    <td className="text-xs">{dateShort(inv.issueDate)}</td>
                    <td className="text-xs">{dueLabel(inv.dueDate)}</td>
                    <td>
                      <StatusPill status={inv.status} />
                    </td>
                    <td className="num money">{money(inv.total)}</td>
                    <td className={`num ${balance === 0 ? "text-faint" : "money"}`}>{balance === 0 ? "settled" : money(balance)}</td>
                    <td className="text-right">
                      {payable(inv) && (
                        <button className="btn btn-primary" style={{ height: 30 }} onClick={() => setPaying(inv)}>
                          Pay now
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {paying && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center px-4" style={{ background: "rgba(10,10,10,0.4)" }}>
          <div className="card w-full max-w-[420px] p-6">
            <h2 className="text-[16px] font-medium">Pay {paying.number}</h2>
            <p className="text-sm text-muted mt-1">Mock checkout — the API validates the amount range.</p>

            <div className="mt-4 space-y-2 text-sm">
              {(["full", "partial"] as const).map((m) => {
                const balance = paying.total - paying.paidTotal;
                return (
                  <label
                    key={m}
                    className="flex items-center justify-between px-3 py-2.5 rounded-[6px] cursor-pointer"
                    style={{
                      border: `1px solid ${mode === m ? "var(--color-ink)" : "var(--color-line)"}`,
                      fontWeight: 500,
                      background: mode === m ? "#fafafa" : undefined,
                    }}
                  >
                    <span className="flex items-center gap-2">
                      <input type="radio" name="mode" checked={mode === m} onChange={() => setMode(m)} />
                      {m === "full" ? "Pay in full" : "Pay a part"}
                    </span>
                    <span className="money">{m === "full" ? money(balance) : ""}</span>
                  </label>
                );
              })}
            </div>

            {mode === "partial" && (
              <div className="mt-3">
                <label className="field-label" htmlFor="partial-amt">
                  Amount (₹)
                </label>
                <input
                  id="partial-amt"
                  type="number"
                  step="0.01"
                  min="0.01"
                  max={(paying.total - paying.paidTotal) / 100}
                  className="input tnum"
                  value={partial}
                  onChange={(e) => setPartial(e.target.value)}
                />
              </div>
            )}

            <div className="mt-3">
              <label className="field-label" htmlFor="pay-method">
                Method
              </label>
              <select id="pay-method" className="select" value={method} onChange={(e) => setMethod(e.target.value)}>
                <option value="mock_wallet">Mock wallet (demo)</option>
                <option value="upi">UPI</option>
                <option value="card">Card</option>
                <option value="bank_transfer">Bank transfer</option>
              </select>
            </div>

            {error && (
              <p className="text-sm text-negative mt-3" role="alert">
                {error}
              </p>
            )}

            <div className="flex justify-end gap-2 mt-5">
              <button className="btn btn-outline" onClick={() => setPaying(null)}>
                Cancel
              </button>
              <button
                className="btn btn-primary"
                disabled={pay.isPending || (mode === "partial" && !partial)}
                onClick={() => pay.mutate()}
              >
                {pay.isPending ? "Processing…" : `Pay ${mode === "full" ? money(paying.total - paying.paidTotal) : ""}`}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

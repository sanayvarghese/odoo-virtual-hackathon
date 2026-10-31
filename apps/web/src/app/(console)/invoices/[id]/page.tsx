"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { get, post, ApiError } from "@/lib/api";
import { money, dateShort, dateTime, pct } from "@/lib/format";
import { LoadingRows, StatusPill, EmptyState } from "@/components/ui";
import { Modal } from "@/components/modal";
import { useToast } from "@/components/toast";
import { useAuth, isStaff } from "@/lib/auth-context";

interface InvoiceFull {
  id: number;
  number: string;
  status: string;
  issueDate: string;
  dueDate: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  subtotal: number;
  discountTotal: number;
  taxTotal: number;
  total: number;
  paidTotal: number;
  notes: string | null;
  sentAt: string | null;
  subscriptionId: number | null;
}
interface LineFull {
  line: { id: number; description: string; quantity: number; unitPrice: number; subtotal: number; taxTotal: number; total: number };
  taxes: { rate: number }[];
}
interface DiscountFull {
  id: number;
  label: string;
  amount: number;
}
interface PaymentFull {
  id: number;
  amount: number;
  method: string;
  paidAt: string;
  note: string | null;
}

const METHODS = ["upi", "card", "bank_transfer", "cash", "cheque", "mock_wallet"];

export default function InvoiceDetailPage() {
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { user } = useAuth();
  const staff = isStaff(user?.role);

  const [payOpen, setPayOpen] = useState(false);
  const [payForm, setPayForm] = useState({ amount: "", method: "upi", note: "" });
  const [error, setError] = useState<string | null>(null);

  const detail = useQuery({
    queryKey: ["invoice", id],
    queryFn: () =>
      get<{ invoice: InvoiceFull; lines: LineFull[]; discounts: DiscountFull[]; payments: PaymentFull[]; customer: { customer: { companyName: string; contactName: string; address: string | null }; email: string } | null }>(
        `/invoices/${id}`,
      ),
  });

  const act = useMutation({
    mutationFn: (action: string) => post(`/invoices/${id}/${action}`, {}),
    onSuccess: (_r, action) => {
      toast("success", `Invoice ${action}d`);
      void queryClient.invalidateQueries({ queryKey: ["invoice", id] });
      void queryClient.invalidateQueries({ queryKey: ["invoices"] });
    },
    onError: (e) => toast("error", e instanceof ApiError ? e.message : "Action failed"),
  });

  const pay = useMutation({
    mutationFn: () =>
      post("/payments", {
        invoiceId: Number(id),
        amount: Math.round(Number(payForm.amount) * 100),
        method: payForm.method,
        note: payForm.note.trim() || undefined,
      }),
    onSuccess: () => {
      toast("success", "Payment recorded");
      setPayOpen(false);
      setPayForm({ amount: "", method: "upi", note: "" });
      void queryClient.invalidateQueries({ queryKey: ["invoice", id] });
      void queryClient.invalidateQueries({ queryKey: ["invoices"] });
      void queryClient.invalidateQueries({ queryKey: ["payments"] });
      void queryClient.invalidateQueries({ queryKey: ["summary"] });
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : "Payment failed"),
  });

  if (detail.isLoading) return <LoadingRows rows={6} />;
  if (detail.error || !detail.data) {
    return (
      <>
        <p className="text-muted mt-4">This invoice could not be loaded.</p>
        <Link href="/invoices" className="btn btn-outline mt-3">
          Back to invoices
        </Link>
      </>
    );
  }

  const inv = detail.data.invoice;
  const balance = inv.total - inv.paidTotal;
  const customerField = detail.data.customer;

  return (
    <div className="max-w-[860px] mx-auto">
      <div className="flex items-center justify-between print:hidden">
        <Link href="/invoices" className="text-sm text-muted hover:text-ink">
          ← Invoices
        </Link>
        {staff && (
          <div className="flex gap-2">
            {inv.status === "draft" && (
              <>
                <button className="btn btn-ghost" onClick={() => act.mutate("cancel")} disabled={act.isPending}>
                  Void
                </button>
                <button className="btn btn-primary" onClick={() => act.mutate("confirm")} disabled={act.isPending}>
                  Confirm
                </button>
              </>
            )}
            {inv.status === "confirmed" && !inv.sentAt && (
              <button className="btn btn-primary" onClick={() => act.mutate("send")} disabled={act.isPending}>
                Send to customer
              </button>
            )}
            {balance > 0 && ["confirmed", "sent", "partially_paid"].includes(inv.status) && (
              <button
                className="btn btn-ghost"
                onClick={() => {
                  setPayForm((f) => ({ ...f, amount: (balance / 100).toString() }));
                  setPayOpen(true);
                }}
              >
                Record payment
              </button>
            )}
          </div>
        )}
      </div>

      {/* the invoice itself — print-ready */}
      <div className="card mt-4 print:border-0 print:shadow-none" id="invoice-print">
        <div className="px-8 pt-7 pb-8">
          <div className="flex items-start justify-between gap-6 flex-wrap">
            <div>
              <div className="flex items-center gap-3">
                <h1 className="mono-id" style={{ fontSize: 18 }}>
                  {inv.number}
                </h1>
                <StatusPill status={inv.status} />
              </div>
              <p className="text-muted text-sm mt-1">
                {inv.periodStart
                  ? `Billing period ${dateShort(inv.periodStart)} – ${dateShort(inv.periodEnd)}`
                  : `Issued ${dateShort(inv.issueDate)}`}
              </p>
            </div>
            <div className="text-right text-sm">
              <p className="text-[15px] font-medium">Brightloop</p>
              <p className="text-muted">Billing & subscriptions</p>
              <p className="text-faint text-xs mt-2">Issued {dateShort(inv.issueDate)}</p>
              <p className="text-faint text-xs">Due {inv.dueDate ? dateShort(inv.dueDate) : "—"}</p>
            </div>
          </div>

          <div className="mt-7 text-sm">
            <p className="text-faint text-xs mb-1">Billed to</p>
            <p className="font-medium">{customerField?.customer.companyName ?? "—"}</p>
            <p className="text-muted">
              {customerField?.customer.contactName}
              {customerField?.email ? ` · ${customerField.email}` : ""}
            </p>
            {customerField?.customer.address && <p className="text-muted text-xs">{customerField.customer.address}</p>}
          </div>

          <table className="btable mt-6 print:text-[13px]">
            <thead>
              <tr>
                <th>Description</th>
                <th className="num">Qty</th>
                <th className="num">Unit price</th>
                <th className="num">Tax</th>
                <th className="num">Amount</th>
              </tr>
            </thead>
            <tbody>
              {detail.data.lines.map(({ line, taxes }) => {
                const rate = taxes[0]?.rate ?? 0;
                return (
                  <tr key={line.id}>
                    <td className="normal-case">
                      {line.description}
                      {rate > 0 && <span className="text-faint text-xs block">{pct(rate)} applied</span>}
                    </td>
                    <td className="num">{line.quantity}</td>
                    <td className="num">{money(line.unitPrice)}</td>
                    <td className="num">{line.taxTotal ? money(line.taxTotal) : "—"}</td>
                    <td className="num money">{money(line.total)}</td>
                  </tr>
                );
              })}
              {detail.data.discounts.map((d) => (
                <tr key={`disc-${d.id}`}>
                  <td>
                    <span className="pill pill-neutral">{d.label}</span>
                  </td>
                  <td />
                  <td />
                  <td />
                  <td className="num text-positive">−{money(d.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="mt-5 ml-auto w-[300px] text-sm">
            <TotRow label="Subtotal" value={money(inv.subtotal)} />
            {inv.discountTotal > 0 && <TotRow label="Discounts" value={`−${money(inv.discountTotal)}`} tone="positive" />}
            {inv.taxTotal > 0 && <TotRow label="Taxes" value={money(inv.taxTotal)} />}
            <div className="mt-2 pt-2 flex justify-between" style={{ borderTop: "1px solid var(--color-line)" }}>
              <span className="font-medium">Total</span>
              <span className="money">{money(inv.total)}</span>
            </div>
            {inv.paidTotal > 0 && <TotRow label="Paid" value={`−${money(inv.paidTotal)}`} tone="positive" />}
            <div className="mt-1 flex justify-between">
              <span className="font-medium">Balance due</span>
              <span className={balance === 0 ? "text-faint" : "money text-negative"}>{balance === 0 ? "settled" : money(balance)}</span>
            </div>
          </div>

          {detail.data.payments.length > 0 && (
            <div className="mt-8">
              <p className="text-faint text-xs mb-2">Payments</p>
              <table className="btable">
                <tbody>
                  {detail.data.payments.map((p) => (
                    <tr key={p.id}>
                      <td>{dateTime(p.paidAt)}</td>
                      <td className="capitalize">{p.method.replace(/_/g, " ")}</td>
                      {p.note && <td className="text-muted text-xs">{p.note}</td>}
                      <td className="num money">{money(p.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {inv.notes && <p className="text-xs text-muted mt-6 whitespace-pre-wrap">{inv.notes}</p>}
        </div>
      </div>

      <button className="btn btn-outline mt-4 print:hidden" onClick={() => window.print()}>
        Print / save as PDF
      </button>

      {payOpen && (
        <Modal title="Record payment" desc={`Balance due ${money(balance)}`} width={460} onClose={() => setPayOpen(false)}>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              pay.mutate();
            }}
          >
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="field-label" htmlFor="pay-amt">
                  Amount (₹)
                </label>
                <input
                  id="pay-amt"
                  type="number"
                  step="0.01"
                  min="0"
                  max={balance / 100}
                  className="input tnum"
                  value={payForm.amount}
                  onChange={(e) => setPayForm({ ...payForm, amount: e.target.value })}
                  required
                />
              </div>
              <div>
                <label className="field-label" htmlFor="pay-method">
                  Method
                </label>
                <select id="pay-method" className="select" value={payForm.method} onChange={(e) => setPayForm({ ...payForm, method: e.target.value })}>
                  {METHODS.map((m) => (
                    <option key={m} value={m}>
                      {m.replace(/_/g, " ")}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div>
              <label className="field-label" htmlFor="pay-note">
                Note <span className="text-faint font-normal">optional</span>
              </label>
              <input id="pay-note" className="input" value={payForm.note} onChange={(e) => setPayForm({ ...payForm, note: e.target.value })} />
            </div>
            {error && (
              <p className="text-sm text-negative" role="alert">
                {error}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <button type="button" className="btn btn-outline" onClick={() => setPayOpen(false)}>
                Cancel
              </button>
              <button type="submit" className="btn btn-primary" disabled={pay.isPending}>
                {pay.isPending ? "Recording…" : "Record payment"}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}

function TotRow({ label, value, tone }: { label: string; value: string; tone?: "positive" }) {
  return (
    <div className={`flex justify-between py-0.5 ${tone === "positive" ? "text-positive" : ""}`}>
      <span className="text-muted">{label}</span>
      <span className="tnum">{value}</span>
    </div>
  );
}

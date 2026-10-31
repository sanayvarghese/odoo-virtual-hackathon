"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { get, post, patch, del, ApiError } from "@/lib/api";
import { money, dateShort } from "@/lib/format";
import { SectionTitle, EmptyState, LoadingRows } from "@/components/ui";
import { Modal } from "@/components/modal";
import { ImportWizard } from "@/components/import-wizard";
import { useToast } from "@/components/toast";
import { useAuth } from "@/lib/auth-context";

interface Plan {
  id: number;
  productId: number;
  productName: string;
  productSku: string;
  name: string;
  description: string | null;
  interval: "daily" | "weekly" | "monthly" | "yearly";
  price: number;
  minQty: number;
  validFrom: string;
  validTo: string | null;
  autoCloseAtEnd: boolean;
  allowPause: boolean;
  allowEarlyCancel: boolean;
  autoRenew: boolean;
  isActive: boolean;
}

const emptyForm = {
  productId: "",
  name: "",
  description: "",
  interval: "monthly",
  price: "",
  minQty: "1",
  validFrom: new Date().toISOString().slice(0, 10),
  validTo: "",
  autoCloseAtEnd: false,
  allowPause: true,
  allowEarlyCancel: true,
  autoRenew: true,
};

export default function PlansPage() {
  const admin = useAdminGate();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [editing, setEditing] = useState<Plan | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState<string | null>(null);

  const plans = useQuery({
    queryKey: ["plans"],
    queryFn: () => get<{ items: Plan[] }>("/plans"),
  });

  const products = useQuery({
    queryKey: ["product-options"],
    queryFn: () => get<{ items: { id: number; sku: string; name: string }[] }>("/products?limit=100&sort=sku&dir=asc"),
  });

  const save = useMutation({
    mutationFn: async () => {
      const payload = {
        productId: Number(form.productId),
        name: form.name.trim(),
        description: form.description.trim() || undefined,
        interval: form.interval,
        price: Math.round(Number(form.price) * 100),
        minQty: Math.max(1, Number(form.minQty) || 1),
        validFrom: form.validFrom || undefined,
        validTo: form.validTo || null,
        autoCloseAtEnd: form.autoCloseAtEnd,
        allowPause: form.allowPause,
        allowEarlyCancel: form.allowEarlyCancel,
        autoRenew: form.autoRenew,
      };
      return editing ? patch(`/plans/${editing.id}`, payload) : post("/plans", payload);
    },
    onSuccess: () => {
      toast("success", editing ? "Plan updated" : "Plan created");
      void queryClient.invalidateQueries({ queryKey: ["plans"] });
      closeForm();
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : "Save failed"),
  });

  const activate = useMutation({
    mutationFn: ({ id, isActive }: { id: number; isActive: boolean }) => patch(`/plans/${id}`, { isActive }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["plans"] }),
    onError: (e) => toast("error", e instanceof ApiError ? e.message : "Update failed"),
  });

  const billNow = useMutation({
    mutationFn: () => post<{ created: number; skipped: number }>("/billing/run", {}),
    onSuccess: (r) => {
      toast(
        "success",
        `Billing run finished — ${r.created} invoice${r.created === 1 ? "" : "s"} created${
          r.skipped ? `, ${r.skipped} already billed` : ""
        }.`,
      );
      void queryClient.invalidateQueries({ queryKey: ["summary"] });
    },
    onError: (e) => toast("error", e instanceof ApiError ? e.message : "Billing run failed"),
  });

  function closeForm() {
    setEditing(null);
    setCreating(false);
    setError(null);
    setForm(emptyForm);
  }

  function openEdit(p: Plan) {
    setForm({
      productId: String(p.productId),
      name: p.name,
      description: p.description ?? "",
      interval: p.interval,
      price: (p.price / 100).toString(),
      minQty: String(p.minQty),
      validFrom: p.validFrom?.slice(0, 10) ?? "",
      validTo: p.validTo?.slice(0, 10) ?? "",
      autoCloseAtEnd: p.autoCloseAtEnd,
      allowPause: p.allowPause,
      allowEarlyCancel: p.allowEarlyCancel,
      autoRenew: p.autoRenew,
    });
    setEditing(p);
  }

  const set =
    (k: keyof typeof emptyForm, kind?: "bool") =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
      setForm({ ...form, [k]: kind === "bool" ? (e.target as HTMLInputElement).checked : e.target.value });

  return (
    <>
      <SectionTitle
        title="Plans"
        desc="Recurring offers. Interval, minimum quantity and which lifecycle moves each plan allows."
        action={
          admin && (
            <>
              <ImportWizard entity="plan" onDone={() => queryClient.invalidateQueries({ queryKey: ["plans"] })} />
              <button className="btn btn-outline" disabled={billNow.isPending} onClick={() => billNow.mutate()} title="Bill every subscription due today — safe to rerun">
                {billNow.isPending ? "Running…" : "Run billing"}
              </button>
              <button className="btn btn-primary" onClick={() => setCreating(true)}>
                <Plus size={15} /> New plan
              </button>
            </>
          )
        }
      />

      <div className="card">
        {plans.isLoading ? (
          <LoadingRows rows={4} />
        ) : !plans.data || plans.data.items.length === 0 ? (
          <EmptyState title="No plans yet" hint="A plan tells Brightloop what to bill, how often, and for how long." />
        ) : (
          <table className="btable">
            <thead>
              <tr>
                <th>Plan</th>
                <th>Product</th>
                <th>Interval</th>
                <th className="num">Price</th>
                <th className="num">Min qty</th>
                <th>Availability</th>
                <th>Lifecycle</th>
                {admin && <th style={{ width: 130 }} />}
              </tr>
            </thead>
            <tbody>
              {plans.data.items.map((p) => (
                <tr key={p.id}>
                  <td>
                    <span className="block">{p.name}</span>
                    {p.description && <span className="text-xs text-faint block truncate max-w-[220px]">{p.description}</span>}
                  </td>
                  <td>
                    <span className="block">{p.productName}</span>
                    <span className="mono-id text-faint">{p.productSku}</span>
                  </td>
                  <td className="capitalize">{p.interval}</td>
                  <td className="num money">{money(p.price)}</td>
                  <td className="num">{p.minQty}</td>
                  <td className="text-xs">
                    {dateShort(p.validFrom)} → {p.validTo ? dateShort(p.validTo) : "∞"}
                  </td>
                  <td>
                    <div className="flex gap-1 flex-wrap max-w-[220px]">
                      {p.allowPause && <span className="pill pill-neutral">pause</span>}
                      {p.allowEarlyCancel && <span className="pill pill-neutral">cancel</span>}
                      {p.autoRenew && <span className="pill pill-neutral">auto-renew</span>}
                      {p.autoCloseAtEnd && <span className="pill pill-neutral">auto-close</span>}
                    </div>
                  </td>
                  {admin && (
                    <td className="text-right">
                      <button className="text-sm text-muted hover:text-ink cursor-pointer mr-4" onClick={() => openEdit(p)}>
                        Edit
                      </button>
                      <button
                        className="text-sm text-muted hover:text-ink cursor-pointer"
                        onClick={() => activate.mutate({ id: p.id, isActive: !p.isActive })}
                      >
                        {p.isActive ? "Retire" : "Restore"}
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {(creating || editing) && (
        <Modal
          title={editing ? "Edit plan" : "New plan"}
          desc="The lifecycle flags decide what customers and admins can later do with a subscription on this plan."
          width={620}
          onClose={closeForm}
        >
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              save.mutate();
            }}
          >
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="field-label" htmlFor="pl-product">
                  Product
                </label>
                <select id="pl-product" className="select" value={form.productId} onChange={set("productId")} required>
                  <option value="">Choose…</option>
                  {(products.data?.items ?? []).map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.sku} — {p.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="field-label" htmlFor="pl-name">
                  Plan name
                </label>
                <input id="pl-name" className="input" value={form.name} onChange={set("name")} required />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="field-label" htmlFor="pl-interval">
                  Interval
                </label>
                <select id="pl-interval" className="select" value={form.interval} onChange={set("interval")}>
                  <option value="daily">Daily</option>
                  <option value="weekly">Weekly</option>
                  <option value="monthly">Monthly</option>
                  <option value="yearly">Yearly</option>
                </select>
              </div>
              <div>
                <label className="field-label" htmlFor="pl-price">
                  Price (₹ / period)
                </label>
                <input
                  id="pl-price"
                  type="number"
                  step="0.01"
                  min="0"
                  className="input tnum"
                  value={form.price}
                  onChange={set("price")}
                  required
                />
              </div>
              <div>
                <label className="field-label" htmlFor="pl-minqty">
                  Minimum quantity
                </label>
                <input id="pl-minqty" type="number" min="1" className="input tnum" value={form.minQty} onChange={set("minQty")} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="field-label" htmlFor="pl-from">
                  Available from
                </label>
                <input id="pl-from" type="date" className="input" value={form.validFrom} onChange={set("validFrom")} />
              </div>
              <div>
                <label className="field-label" htmlFor="pl-to">
                  Available until <span className="text-faint font-normal">blank = forever</span>
                </label>
                <input id="pl-to" type="date" className="input" value={form.validTo} onChange={set("validTo")} />
              </div>
            </div>
            <div>
              <label className="field-label" htmlFor="pl-desc">
                Description <span className="text-faint font-normal">optional</span>
              </label>
              <textarea id="pl-desc" className="textarea" rows={2} value={form.description} onChange={set("description")} />
            </div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-2">
              <Toggle id="autoRenew" checked={form.autoRenew} onChange={set("autoRenew", "bool")} label="Auto-renew" />
              <Toggle id="allowPause" checked={form.allowPause} onChange={set("allowPause", "bool")} label="Allow pause / resume" />
              <Toggle id="allowEarlyCancel" checked={form.allowEarlyCancel} onChange={set("allowEarlyCancel", "bool")} label="Allow early cancel" />
              <Toggle id="autoCloseAtEnd" checked={form.autoCloseAtEnd} onChange={set("autoCloseAtEnd", "bool")} label="Close automatically at end date" />
            </div>
            {error && (
              <p className="text-sm text-negative" role="alert">
                {error}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <button type="button" className="btn btn-outline" onClick={closeForm}>
                Cancel
              </button>
              <button type="submit" className="btn btn-primary" disabled={save.isPending}>
                {save.isPending ? "Saving…" : editing ? "Save changes" : "Create plan"}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}

function useAdminGate(): boolean {
  const { user } = useAuth();
  return user?.role === "admin";
}

function Toggle({
  id,
  checked,
  onChange,
  label,
}: {
  id: string;
  checked: boolean;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  label: string;
}) {
  return (
    <label className="flex items-center gap-2 text-sm cursor-pointer" htmlFor={id}>
      <input id={id} type="checkbox" checked={checked} onChange={onChange} />
      {label}
    </label>
  );
}

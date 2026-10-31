"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Search } from "lucide-react";
import { get, post, patch, del, qs, ApiError } from "@/lib/api";
import { money } from "@/lib/format";
import { SectionTitle, EmptyState, LoadingRows, StatusPill } from "@/components/ui";
import { Modal } from "@/components/modal";
import { ImportWizard } from "@/components/import-wizard";
import { useToast } from "@/components/toast";
import { useAuth, isStaff } from "@/lib/auth-context";

interface Product {
  id: number;
  sku: string;
  name: string;
  kind: "software" | "addon" | "service";
  salesPrice: number;
  costPrice: number;
  notes: string | null;
  isActive: boolean;
}

const emptyForm = { sku: "", name: "", kind: "software", salesPrice: "", costPrice: "0", notes: "" };

export default function ProductsPage() {
  const { user } = useAuth();
  const admin = isStaff(user?.role) && user?.role === "admin";
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [editing, setEditing] = useState<Product | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState<string | null>(null);

  const list = useQuery({
    queryKey: ["products", { q, page }],
    queryFn: () =>
      get<{ items: Product[]; total: number; page: number; limit: number }>(
        `/products${qs({ q, page, limit: 15 })}`,
      ),
  });

  const save = useMutation({
    mutationFn: async () => {
      const payload = {
        sku: form.sku.trim() || undefined,
        name: form.name.trim(),
        kind: form.kind,
        salesPrice: Math.round(Number(form.salesPrice) * 100),
        costPrice: Math.round(Number(form.costPrice) * 100),
        notes: form.notes.trim() || undefined,
      };
      return editing
        ? patch<{ product: Product }>(`/products/${editing.id}`, payload)
        : post<{ product: Product }>("/products", payload);
    },
    onSuccess: (r) => {
      toast("success", `${r.product.name} ${editing ? "updated" : "created"} — id ${r.product.id}`);
      void queryClient.invalidateQueries({ queryKey: ["products"] });
      closeForm();
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : "Save failed"),
  });

  const remove = useMutation({
    mutationFn: (id: number) => del(`/products/${id}`),
    onSuccess: () => {
      toast("success", "Product deleted");
      void queryClient.invalidateQueries({ queryKey: ["products"] });
    },
    onError: (e) => toast("error", e instanceof ApiError ? e.message : "Delete failed"),
  });

  function closeForm() {
    setEditing(null);
    setCreating(false);
    setError(null);
    setForm(emptyForm);
  }

  function openEdit(p: Product) {
    setEditing(p);
    setForm({
      sku: p.sku,
      name: p.name,
      kind: p.kind,
      salesPrice: (p.salesPrice / 100).toString(),
      costPrice: (p.costPrice / 100).toString(),
      notes: p.notes ?? "",
    });
  }

  const set = (k: keyof typeof emptyForm) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm({ ...form, [k]: e.target.value });

  return (
    <>
      <SectionTitle
        title="Products"
        desc="The catalogue that plans and subscriptions bill from."
        action={
          <>
            {admin && <ImportWizard entity="product" onDone={() => queryClient.invalidateQueries({ queryKey: ["products"] })} />}
            {admin && (
              <button className="btn btn-primary" onClick={() => setCreating(true)}>
                <Plus size={15} /> New product
              </button>
            )}
          </>
        }
      />

      <div className="relative mb-3 max-w-[320px]">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
        <input
          className="input pl-8"
          placeholder="Search by name"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setPage(1);
          }}
        />
      </div>

      <div className="card">
        {list.isLoading ? (
          <LoadingRows rows={5} />
        ) : !list.data || list.data.items.length === 0 ? (
          <EmptyState
            title={q ? `No products match “${q}”` : "No products yet"}
            hint={
              admin
                ? "Create one manually or run the bulk import — paste any spreadsheet shape and the local AI maps it."
                : "The catalogue is empty; the admin can add products from the console."
            }
          />
        ) : (
          <table className="btable">
            <thead>
              <tr>
                <th>SKU</th>
                <th>Name</th>
                <th>Kind</th>
                <th className="num">Sales price</th>
                <th className="num">Cost price</th>
                <th>Status</th>
                {admin && <th style={{ width: 130 }} />}
              </tr>
            </thead>
            <tbody>
              {list.data.items.map((p) => (
                <tr key={p.id}>
                  <td className="mono-id">{p.sku}</td>
                  <td className="max-w-[260px] truncate" title={p.notes ?? undefined}>
                    {p.name}
                  </td>
                  <td className="capitalize text-muted">{p.kind}</td>
                  <td className="num money">{money(p.salesPrice)}</td>
                  <td className="num">{money(p.costPrice)}</td>
                  <td>
                    <StatusPill status={p.isActive ? "enabled" : "disabled"} />
                  </td>
                  {admin && (
                    <td className="text-right">
                      <button className="text-sm text-muted hover:text-ink cursor-pointer mr-4" onClick={() => openEdit(p)}>
                        Edit
                      </button>
                      <button
                        className="text-sm text-muted hover:text-negative cursor-pointer"
                        onClick={() => {
                          if (confirm(`Delete ${p.name}? This cannot be undone.`)) remove.mutate(p.id);
                        }}
                      >
                        Delete
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {list.data && list.data.total > list.data.limit && (
          <div className="flex items-center justify-between px-6 py-3" style={{ borderTop: "1px solid var(--color-rule)" }}>
            <span className="text-xs text-faint">
              {list.data.total} products · page {list.data.page}
            </span>
            <div className="flex gap-2">
              <button className="btn btn-outline" style={{ height: 28 }} disabled={page <= 1} onClick={() => setPage(page - 1)}>
                Previous
              </button>
              <button
                className="btn btn-outline"
                style={{ height: 28 }}
                disabled={page * list.data.limit >= list.data.total}
                onClick={() => setPage(page + 1)}
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>

      {(creating || editing) && (
        <Modal
          title={editing ? "Edit product" : "New product"}
          desc={editing ? undefined : "Prices are what plans reference; plans do the recurring billing."}
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
                <label className="field-label" htmlFor="p-sku">
                  SKU <span className="text-faint font-normal">optional</span>
                </label>
                <input id="p-sku" className="input font-mono" value={form.sku} onChange={set("sku")} disabled={!!editing} />
              </div>
              <div>
                <label className="field-label" htmlFor="p-kind">
                  Kind
                </label>
                <select id="p-kind" className="select" value={form.kind} onChange={set("kind")}>
                  <option value="software">Software</option>
                  <option value="addon">Addon</option>
                  <option value="service">Service</option>
                </select>
              </div>
            </div>
            <div>
              <label className="field-label" htmlFor="p-name">
                Name
              </label>
              <input id="p-name" className="input" value={form.name} onChange={set("name")} required />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="field-label" htmlFor="p-sales">
                  Sales price (₹)
                </label>
                <input
                  id="p-sales"
                  type="number"
                  step="0.01"
                  min="0"
                  className="input tnum"
                  value={form.salesPrice}
                  onChange={set("salesPrice")}
                  required
                />
              </div>
              <div>
                <label className="field-label" htmlFor="p-cost">
                  Cost price (₹)
                </label>
                <input
                  id="p-cost"
                  type="number"
                  step="0.01"
                  min="0"
                  className="input tnum"
                  value={form.costPrice}
                  onChange={set("costPrice")}
                />
              </div>
            </div>
            <div>
              <label className="field-label" htmlFor="p-notes">
                Notes <span className="text-faint font-normal">optional</span>
              </label>
              <textarea id="p-notes" className="textarea" rows={2} value={form.notes} onChange={set("notes")} />
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
                {save.isPending ? "Saving…" : editing ? "Save changes" : "Create product"}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}

"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { get, post, patch, ApiError } from "@/lib/api";
import { money, pct, dateShort } from "@/lib/format";
import { SectionTitle, EmptyState, LoadingRows } from "@/components/ui";
import { Modal } from "@/components/modal";
import { useToast } from "@/components/toast";
import { useAuth } from "@/lib/auth-context";

interface TaxRule {
  id: number;
  name: string;
  rate: number; // percent*100
  description: string | null;
  isActive: boolean;
}

interface DiscountRule {
  id: number;
  code: string;
  name: string;
  kind: "fixed" | "percent";
  value: number; // cents or percent*100
  minPurchase: number;
  minQty: number;
  startsAt: string;
  endsAt: string | null;
  maxUses: number | null;
  usedCount: number;
  scope: "product" | "subscription";
  productName: string | null;
  isActive: boolean;
}

export default function TaxesPage() {
  useAdminOnly();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const taxes = useQuery({ queryKey: ["taxes"], queryFn: () => get<{ items: TaxRule[] }>("/taxes") });
  const discounts = useQuery({ queryKey: ["discounts"], queryFn: () => get<{ items: DiscountRule[] }>("/discounts") });

  const [taxOpen, setTaxOpen] = useState(false);
  const [taxForm, setTaxForm] = useState({ name: "", rate: "", description: "" });
  const [taxErr, setTaxErr] = useState<string | null>(null);

  const [discOpen, setDiscOpen] = useState(false);
  const [discForm, setDiscForm] = useState({
    code: "",
    name: "",
    kind: "percent",
    value: "",
    minPurchase: "",
    minQty: "",
    endsAt: "",
    maxUses: "",
    scope: "subscription",
    productId: "",
  });
  const [discErr, setDiscErr] = useState<string | null>(null);

  const saveTax = useMutation({
    mutationFn: () =>
      post("/taxes", {
        name: taxForm.name.trim(),
        rate: Math.round(Number(taxForm.rate) * 100),
        description: taxForm.description.trim() || undefined,
      }),
    onSuccess: () => {
      toast("success", "Tax rule created");
      setTaxOpen(false);
      setTaxForm({ name: "", rate: "", description: "" });
      void queryClient.invalidateQueries({ queryKey: ["taxes"] });
    },
    onError: (e) => setTaxErr(e instanceof ApiError ? e.message : "Save failed"),
  });

  const saveDisc = useMutation({
    mutationFn: () =>
      post("/discounts", {
        code: discForm.code.trim().toUpperCase(),
        name: discForm.name.trim(),
        kind: discForm.kind,
        value:
          discForm.kind === "percent"
            ? Math.round(Number(discForm.value) * 100)
            : Math.round(Number(discForm.value) * 100),
        minPurchase: Math.round(Number(discForm.minPurchase || "0") * 100),
        minQty: Math.max(0, Number(discForm.minQty || "0")),
        endsAt: discForm.endsAt || undefined,
        maxUses: discForm.maxUses ? Number(discForm.maxUses) : undefined,
        scope: discForm.scope,
        productId: discForm.scope === "product" ? Number(discForm.productId) : undefined,
      }),
    onSuccess: () => {
      toast("success", "Discount rule created");
      setDiscOpen(false);
      void queryClient.invalidateQueries({ queryKey: ["discounts"] });
    },
    onError: (e) => setDiscErr(e instanceof ApiError ? e.message : "Save failed"),
  });

  return (
    <>
      <SectionTitle
        title="Taxes & discounts"
        desc="Rates snapshot into invoice lines at confirm time — later edits never rewrite history."
        action={
          <>
            <button className="btn btn-ghost" onClick={() => setDiscOpen(true)}>
              <Plus size={15} /> Discount
            </button>
            <button className="btn btn-primary" onClick={() => setTaxOpen(true)}>
              <Plus size={15} /> Tax rule
            </button>
          </>
        }
      />

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-3 items-start min-w-0">
        <div className="card min-w-0">
          <div className="px-6 py-4" style={{ borderBottom: "1px solid var(--color-rule)" }}>
            <h2 className="text-[16px] font-medium">Tax rules</h2>
          </div>
          {taxes.isLoading ? (
            <LoadingRows rows={3} />
          ) : !taxes.data || taxes.data.items.length === 0 ? (
            <EmptyState title="No tax rules" />
          ) : (
            <div className="overflow-x-auto">
            <table className="btable">
              <thead>
                <tr>
                  <th>Name</th>
                  <th className="num">Rate</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {taxes.data.items.map((t) => (
                  <tr key={t.id}>
                    <td>
                      {t.name}
                      {t.description && <span className="text-xs text-faint block">{t.description}</span>}
                    </td>
                    <td className="num money">{pct(t.rate)}</td>
                    <td>
                      <span className={`pill ${t.isActive ? "pill-positive" : "pill-neutral"}`}>
                        {t.isActive ? "active" : "retired"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          )}
        </div>

        <div className="card min-w-0">
          <div className="px-6 py-4" style={{ borderBottom: "1px solid var(--color-rule)" }}>
            <h2 className="text-[16px] font-medium">Discount rules</h2>
          </div>
          {discounts.isLoading ? (
            <LoadingRows rows={3} />
          ) : !discounts.data || discounts.data.items.length === 0 ? (
            <EmptyState title="No discount rules" hint="Codes like WELCOME10 apply at subscription level or per product." />
          ) : (
            <div className="overflow-x-auto">
            <table className="btable">
              <thead>
                <tr>
                  <th>Code</th>
                  <th>Applies to</th>
                  <th className="num">Value</th>
                  <th className="num">Used</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {discounts.data.items.map((d) => (
                  <tr key={d.id} style={d.isActive ? undefined : { opacity: 0.5 }}>
                    <td>
                      <span className="block mono-id">{d.code}</span>
                      <span className="text-xs text-muted">{d.name}</span>
                    </td>
                    <td className="text-xs">
                      {d.scope === "product" ? (d.productName ?? "product") : "any subscription"}
                      <span className="text-faint block">
                        {dateShort(d.startsAt)} → {d.endsAt ? dateShort(d.endsAt) : "∞"}
                      </span>
                    </td>
                    <td className="num money">{d.kind === "percent" ? pct(d.value) : `${money(d.value)} off`}</td>
                    <td className="num">{d.usedCount}{d.maxUses ? `/${d.maxUses}` : ""}</td>
                    <td>
                      <span className={`pill ${d.isActive ? "pill-positive" : "pill-neutral"}`}>
                        {d.isActive ? "active" : "off"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          )}
        </div>
      </div>

      {taxOpen && (
        <Modal title="New tax rule" desc="Rate is applied per billed line at confirm time." width={480} onClose={() => setTaxOpen(false)}>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              saveTax.mutate();
            }}
          >
            <div>
              <label className="field-label" htmlFor="t-name">
                Name
              </label>
              <input id="t-name" className="input" placeholder="GST 18%" value={taxForm.name} onChange={(e) => setTaxForm({ ...taxForm, name: e.target.value })} required />
            </div>
            <div>
              <label className="field-label" htmlFor="t-rate">
                Rate (%)
              </label>
              <input
                id="t-rate"
                type="number"
                step="0.01"
                min="0"
                max="100"
                className="input tnum"
                value={taxForm.rate}
                onChange={(e) => setTaxForm({ ...taxForm, rate: e.target.value })}
                required
              />
            </div>
            <div>
              <label className="field-label" htmlFor="t-desc">
                Description <span className="text-faint font-normal">optional</span>
              </label>
              <input id="t-desc" className="input" value={taxForm.description} onChange={(e) => setTaxForm({ ...taxForm, description: e.target.value })} />
            </div>
            {taxErr && (
              <p className="text-sm text-negative" role="alert">
                {taxErr}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <button type="button" className="btn btn-outline" onClick={() => setTaxOpen(false)}>
                Cancel
              </button>
              <button type="submit" className="btn btn-primary" disabled={saveTax.isPending}>
                {saveTax.isPending ? "Saving…" : "Create tax rule"}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {discOpen && (
        <Modal title="New discount rule" desc="Fixed rules are in ₹; percent rules cap at 90%." width={560} onClose={() => setDiscOpen(false)}>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              saveDisc.mutate();
            }}
          >
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="field-label" htmlFor="d-code">
                  Code
                </label>
                <input id="d-code" className="input font-mono" placeholder="WELCOME10" value={discForm.code} onChange={(e) => setDiscForm({ ...discForm, code: e.target.value })} required />
              </div>
              <div>
                <label className="field-label" htmlFor="d-name">
                  Label
                </label>
                <input id="d-name" className="input" value={discForm.name} onChange={(e) => setDiscForm({ ...discForm, name: e.target.value })} required />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="field-label" htmlFor="d-kind">
                  Kind
                </label>
                <select id="d-kind" className="select" value={discForm.kind} onChange={(e) => setDiscForm({ ...discForm, kind: e.target.value })}>
                  <option value="percent">Percent off</option>
                  <option value="fixed">Fixed ₹ off</option>
                </select>
              </div>
              <div>
                <label className="field-label" htmlFor="d-value">
                  {discForm.kind === "percent" ? "Percent (%)" : "Amount (₹)"}
                </label>
                <input
                  id="d-value"
                  type="number"
                  step="0.01"
                  min="0"
                  max={discForm.kind === "percent" ? 90 : undefined}
                  className="input tnum"
                  value={discForm.value}
                  onChange={(e) => setDiscForm({ ...discForm, value: e.target.value })}
                  required
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="field-label" htmlFor="d-scope">
                  Applies to
                </label>
                <select id="d-scope" className="select" value={discForm.scope} onChange={(e) => setDiscForm({ ...discForm, scope: e.target.value })}>
                  <option value="subscription">Any subscription</option>
                  <option value="product">One product only</option>
                </select>
              </div>
              {discForm.scope === "product" && (
                <div>
                  <label className="field-label" htmlFor="d-product">
                    Product ID
                  </label>
                  <input id="d-product" type="number" min="1" className="input tnum" value={discForm.productId} onChange={(e) => setDiscForm({ ...discForm, productId: e.target.value })} required />
                </div>
              )}
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="field-label" htmlFor="d-minpur">
                  Min purchase (₹)
                </label>
                <input id="d-minpur" type="number" step="0.01" min="0" className="input tnum" value={discForm.minPurchase} onChange={(e) => setDiscForm({ ...discForm, minPurchase: e.target.value })} />
              </div>
              <div>
                <label className="field-label" htmlFor="d-minqty">
                  Min quantity
                </label>
                <input id="d-minqty" type="number" min="0" className="input tnum" value={discForm.minQty} onChange={(e) => setDiscForm({ ...discForm, minQty: e.target.value })} />
              </div>
              <div>
                <label className="field-label" htmlFor="d-max">
                  Max uses <span className="text-faint font-normal">∞ if blank</span>
                </label>
                <input id="d-max" type="number" min="1" className="input tnum" value={discForm.maxUses} onChange={(e) => setDiscForm({ ...discForm, maxUses: e.target.value })} />
              </div>
            </div>
            {discErr && (
              <p className="text-sm text-negative" role="alert">
                {discErr}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <button type="button" className="btn btn-outline" onClick={() => setDiscOpen(false)}>
                Cancel
              </button>
              <button type="submit" className="btn btn-primary" disabled={saveDisc.isPending}>
                {saveDisc.isPending ? "Saving…" : "Create discount"}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}

function useAdminOnly() {
  const { user } = useAuth();
  return user?.role === "admin";
}

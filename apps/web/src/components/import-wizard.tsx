"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { get, post, API_BASE } from "@/lib/api";
import { Modal } from "@/components/modal";
import { useToast } from "@/components/toast";

/**
 * Bulk-import wizard (hybrid parser): paste text or upload an .xlsx/.csv →
 * the backend maps headers deterministically and only wakes the local model
 * when heuristics stall → preview grid with per-row status → commit valid
 * rows (force skips invalid ones). Rows are never invented by the model.
 */

interface PreviewRow {
  row: number;
  ok: boolean;
  errors: string[];
  data: Record<string, unknown>;
}

export interface ImportPreview {
  jobId: string;
  entity: string;
  totalRows: number;
  validCount: number;
  invalidCount: number;
  validBeforeFix: number;
  rows: PreviewRow[];
  columns: Record<string, string | null>;
}

const ENTITY_LABEL: Record<string, string> = { product: "products", plan: "plans", customer: "customers" };

export function ImportWizard({
  entity = "product",
  onDone,
}: {
  entity?: "product" | "plan" | "customer";
  onDone: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<"input" | "preview">("input");
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [includeInvalid, setIncludeInvalid] = useState(false);
  const { toast } = useToast();

  const parse = useMutation({
    mutationFn: async () => {
      void get; // csrf cookie refresh handled by api client
      const csrf = document.cookie.match(/(?:^|;\s*)bl_csrf=([^;]*)/);
      const headers: Record<string, string> = {};
      if (csrf) headers["X-CSRF-Token"] = decodeURIComponent(csrf[1]!);
      let res: Response;
      if (file) {
        const form = new FormData();
        form.set("file", file);
        res = await fetch(`${API_BASE}/ai/import?entity=${entity}`, {
          method: "POST",
          headers,
          credentials: "include",
          body: form,
        });
      } else {
        res = await fetch(`${API_BASE}/ai/import?entity=${entity}`, {
          method: "POST",
          headers: { ...headers, "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ text }),
        });
      }
      const json = await res.json();
      if (!res.ok) {
        throw new Error(json?.error?.message ?? `Import staging failed (${res.status})`);
      }
      return json as ImportPreview;
    },
    onSuccess: (p) => {
      setPreview(p);
      setStep("preview");
      setError(null);
      setIncludeInvalid(false);
    },
    onError: (e) => setError(e instanceof Error ? e.message : "Import staging failed"),
  });

  const commit = useMutation({
    mutationFn: async () => {
      if (!preview) throw new Error("no preview");
      return post<{ inserted: number; skipped: number }>(
        `/ai/import/${preview.jobId}/commit`,
        { force: includeInvalid },
      );
    },
    onSuccess: (r) => {
      toast("success", `Imported ${r.inserted} ${ENTITY_LABEL[entity]}${r.skipped ? `, skipped ${r.skipped} invalid` : ""}.`);
      reset();
      onDone();
    },
    onError: (e) =>
      toast("error", e instanceof Error ? e.message : "Commit failed"),
  });

  function reset() {
    setOpen(false);
    setStep("input");
    setText("");
    setFile(null);
    setPreview(null);
    setError(null);
  }

  const invalid = preview?.invalidCount ?? 0;
  const FIELD_ORDER = entity === "product"
    ? ["sku", "name", "kind", "salesPrice", "costPrice", "notes"]
    : entity === "plan"
      ? ["productSku", "name", "interval", "price", "minQty", "validFrom", "validTo"]
      : ["companyName", "contactName", "email", "phone", "address"];

  return (
    <>
      <button className="btn btn-ghost" onClick={() => setOpen(true)}>
        Bulk import
      </button>

      {open && (
        <Modal
          title="Bulk import"
          desc={`Paste a table or attach a spreadsheet — the local AI cleans it up before anything touches the database.`}
          width={780}
          onClose={reset}
        >
          {step === "input" && (
            <div className="space-y-4">
              <div>
                <label className="field-label" htmlFor="file">
                  Spreadsheet or CSV
                </label>
                <label
                  className="flex items-center justify-between px-3 cursor-pointer input"
                  style={{ height: "auto", minHeight: 44, paddingTop: 10, paddingBottom: 10 }}
                >
                  <span className={file ? "text-ink" : "text-muted text-sm"}>
                    {file ? file.name : "Choose .xlsx / .xls / .csv — or paste text below"}
                  </span>
                  <span className="btn btn-ghost" style={{ height: 28 }}>
                    Browse
                  </span>
                  <input
                    id="file"
                    type="file"
                    className="hidden"
                    accept=".xlsx,.xls,.csv,.txt"
                    onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                  />
                </label>
              </div>

              <div>
                <label className="field-label" htmlFor="paste">
                  Or paste rows
                </label>
                <textarea
                  id="paste"
                  className="textarea"
                  rows={6}
                  placeholder={"name, price, kind\nGraphQL Booster, 1299, addon\nEmail Relay, 499, service"}
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  disabled={!!file}
                />
              </div>

              {error && (
                <p className="text-sm text-negative" role="alert">
                  {error}
                </p>
              )}

              <div className="flex justify-end gap-2">
                <button className="btn btn-outline" onClick={reset}>
                  Cancel
                </button>
                <button
                  className="btn btn-primary"
                  disabled={parse.isPending || (!file && text.trim().length < 5)}
                  onClick={() => parse.mutate()}
                >
                  {parse.isPending ? "Parsing… (local AI)" : "Parse & preview"}
                </button>
              </div>
            </div>
          )}

          {step === "preview" && preview && (
            <div className="space-y-4">
              <div className="flex items-center gap-3 text-sm">
                <span>
                  <strong className="money">{preview.validCount}</strong> valid
                </span>
                <span className={invalid > 0 ? "text-negative" : "text-faint"}>
                  {invalid} invalid
                </span>
                <span className="text-faint">of {preview.totalRows} rows staged (nothing written yet)</span>
              </div>

              <div className="card overflow-auto" style={{ maxHeight: 320 }}>
                <table className="btable">
                  <thead>
                    <tr>
                      <th style={{ width: 34 }}>#</th>
                      {FIELD_ORDER.filter((f) => preview.columns[f] != null).map((f) => (
                        <th key={f}>{f.replace(/([A-Z])/g, " $1").toLowerCase()}</th>
                      ))}
                      <th>status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.rows.map((r) => (
                      <tr key={r.row} style={r.ok ? undefined : { background: "var(--color-negative-tint)" }}>
                        <td className="text-faint">{r.row}</td>
                        {FIELD_ORDER.filter((f) => preview.columns[f] != null).map((f) => (
                          <td key={f}>{String(r.data[f] ?? "—")}</td>
                        ))}
                        <td>
                          {r.ok ? (
                            <span className="pill pill-positive">valid</span>
                          ) : (
                            <span className="pill pill-negative" title={r.errors.join("; ")}>
                              {r.errors[0]?.slice(0, 40) ?? "invalid"}
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {invalid > 0 && (
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={includeInvalid}
                    onChange={(e) => setIncludeInvalid(e.target.checked)}
                  />
                  Import only the {preview.validCount} valid rows and skip the rest
                </label>
              )}

              <div className="flex justify-end gap-2">
                <button className="btn btn-outline" onClick={() => { setStep("input"); setPreview(null); }}>
                  Back
                </button>
                <button
                  className="btn btn-primary"
                  disabled={commit.isPending || preview.validCount === 0}
                  onClick={() => commit.mutate()}
                >
                  {commit.isPending
                    ? "Committing…"
                    : `Commit ${preview.validCount} ${ENTITY_LABEL[entity]}`}
                </button>
              </div>
            </div>
          )}
        </Modal>
      )}
    </>
  );
}

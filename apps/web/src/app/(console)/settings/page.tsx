"use client";

import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { get, patch } from "@/lib/api";
import { SectionTitle, LoadingRows } from "@/components/ui";
import { useToast } from "@/components/toast";
import { useAuth } from "@/lib/auth-context";

interface CustomerMe {
  id: number;
  companyName: string;
  contactName: string;
  phone: string | null;
  address: string | null;
}

/**
 * Settings — everything here is editable.
 *  Staff/admin: display name (PATCH /auth/me).
 *  Customer: display name + billing profile (PATCH /customers/:id, own record).
 * The server/runtime readouts (AI endpoint, model) stay read-only: they come
 * from validated environment variables and cannot be changed from a form.
 */
export default function SettingsPage() {
  const { user, refresh } = useAuth();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const isCustomer = user?.role === "customer";

  const me = useQuery({
    queryKey: ["customer-me"],
    queryFn: () => get<{ customer: CustomerMe }>("/customers/me"),
    enabled: !!isCustomer,
  });

  const [name, setName] = useState("");
  const [profile, setProfile] = useState({ contactName: "", phone: "", address: "" });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (user) setName(user.name);
  }, [user]);
  useEffect(() => {
    if (me.data) {
      const c = me.data.customer;
      setProfile({ contactName: c.contactName ?? "", phone: c.phone ?? "", address: c.address ?? "" });
    }
  }, [me.data]);

  const saveName = useMutation({
    mutationFn: () => patch("/auth/me", { name: name.trim() }),
    onSuccess: async () => {
      await refresh();
      toast("success", "Name updated");
    },
    onError: (e) => setError(e instanceof Error ? e.message : "Could not save"),
  });

  const saveProfile = useMutation({
    mutationFn: () =>
      patch(`/customers/${me.data!.customer.id}`, {
        contactName: profile.contactName.trim() || undefined,
        phone: profile.phone.trim() || undefined,
        address: profile.address.trim() || undefined,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["customer-me"] });
      toast("success", "Billing profile saved");
    },
    onError: (e) => setError(e instanceof Error ? e.message : "Could not save"),
  });

  const runtime = useQuery({
    queryKey: ["dev-config"],
    queryFn: () =>
      get<{ apiUrl: string; appUrl: string; aiModel: string; aiUrl: string }>("/dev/config"),
  });

  return (
    <div className="max-w-[1152px]">
      <SectionTitle title="Settings" desc="Your identity, billing details, and how the workspace runs." />

      {/* ------------------------------------------------------ identity */}
      <section className="grid grid-cols-1 lg:grid-cols-[minmax(240px,36%)_1fr] gap-6 py-8" style={{ borderTop: "1px solid var(--color-rule)" }}>
        <div className="pt-1">
          <h2 className="text-[16px] font-medium">Your name</h2>
          <p className="text-muted mt-1 leading-relaxed">
            Shown in the sidebar, on timelines and in audit entries. Your sign-in email ({user?.email}) is your identity and cannot be changed here.
          </p>
        </div>
        <div className="rounded-xl bg-[#fafafa] p-4">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              saveName.mutate();
            }}
            className="flex flex-col gap-3"
          >
            <div>
              <label className="field-label" htmlFor="st-name">
                Display name
              </label>
              <input id="st-name" className="input" value={name} onChange={(e) => setName(e.target.value)} required />
            </div>
            <div className="flex justify-end">
              <button type="submit" className="btn btn-primary" disabled={saveName.isPending || name.trim() === user?.name}>
                {saveName.isPending ? "Saving…" : "Save name"}
              </button>
            </div>
          </form>
        </div>
      </section>

      {/* ------------------------------------------- customer profile */}
      {isCustomer && (
        <section className="grid grid-cols-1 lg:grid-cols-[minmax(240px,36%)_1fr] gap-6 py-8" style={{ borderTop: "1px solid var(--color-rule)" }}>
          <div className="pt-1">
            <h2 className="text-[16px] font-medium">Billing profile</h2>
            <p className="text-muted mt-1 leading-relaxed">
              These details appear on your invoices. The company name is fixed at signup; contact us to change it.
            </p>
          </div>
          {me.isLoading ? (
            <LoadingRows rows={2} />
          ) : (
            <div className="rounded-xl bg-[#fafafa] p-4">
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  saveProfile.mutate();
                }}
                className="space-y-4"
              >
                <div>
                  <label className="field-label" htmlFor="st-company">
                    Company
                  </label>
                  <input id="st-company" className="input" value={me.data?.customer.companyName ?? ""} disabled />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="field-label" htmlFor="st-contact">
                      Contact name
                    </label>
                    <input id="st-contact" className="input" value={profile.contactName} onChange={(e) => setProfile({ ...profile, contactName: e.target.value })} />
                  </div>
                  <div>
                    <label className="field-label" htmlFor="st-phone">
                      Phone
                    </label>
                    <input id="st-phone" className="input" value={profile.phone} onChange={(e) => setProfile({ ...profile, phone: e.target.value })} />
                  </div>
                </div>
                <div>
                  <label className="field-label" htmlFor="st-address">
                    Address
                  </label>
                  <input id="st-address" className="input" value={profile.address} onChange={(e) => setProfile({ ...profile, address: e.target.value })} />
                </div>
                <div className="flex justify-end">
                  <button type="submit" className="btn btn-primary" disabled={saveProfile.isPending}>
                    {saveProfile.isPending ? "Saving…" : "Save billing profile"}
                  </button>
                </div>
              </form>
            </div>
          )}
        </section>
      )}

      {/* -------------------------------------------------- security posture */}
      <section className="grid grid-cols-1 lg:grid-cols-[minmax(240px,36%)_1fr] gap-6 py-8" style={{ borderTop: "1px solid var(--color-rule)" }}>
        <div className="pt-1">
          <h2 className="text-[16px] font-medium">Security</h2>
          <p className="text-muted mt-1 leading-relaxed">What protects every session in this workspace.</p>
        </div>
        <div className="rounded-xl bg-[#fafafa] p-4 space-y-3">
          {[
            ["Session cookie", "bl_session is httpOnly and SameSite=Lax; the token is stored hashed in the database and revocable."],
            ["CSRF protection", "Every state-changing request validates the bl_csrf cookie against X-CSRF-Token."],
            ["Passwords", "argon2id, more than 8 characters with upper, lower and a special character."],
            ["Roles", "Admin, staff and customer scopes are enforced server-side on every route."],
          ].map(([t, d]) => (
            <div key={t} className="flex gap-3 rounded-lg bg-surface px-3 py-3">
              <span className="mt-1.5 h-2 w-2 rounded-full shrink-0 bg-positive" />
              <div>
                <p className="text-sm font-medium">
                  {t} <span className="pill pill-positive ml-1">enabled</span>
                </p>
                <p className="text-sm text-muted mt-0.5">{d}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ------------------------------------------------- local runtime */}
      <section className="grid grid-cols-1 lg:grid-cols-[minmax(240px,36%)_1fr] gap-6 py-8" style={{ borderTop: "1px solid var(--color-rule)" }}>
        <div className="pt-1">
          <h2 className="text-[16px] font-medium">Runtime</h2>
          <p className="text-muted mt-1 leading-relaxed">
            Where things run. These come from validated environment variables, so they are read-only here: change them in <code className="mono-id">apps/api/.env</code>.
          </p>
        </div>
        {runtime.isLoading ? (
          <LoadingRows rows={2} />
        ) : runtime.data ? (
          <div className="rounded-xl bg-[#fafafa] p-4 grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="AI model (local Ollama)" value={runtime.data.aiModel} mono />
            <Field label="Ollama endpoint" value={runtime.data.aiUrl} mono />
            <Field label="API endpoint" value={runtime.data.apiUrl} mono />
            <Field label="Web endpoint" value={runtime.data.appUrl} mono />
          </div>
        ) : (
          <p className="text-sm text-muted">Runtime configuration is unavailable while the API is offline.</p>
        )}
      </section>

      {error && (
        <p className="text-sm text-negative pb-6" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <p className="field-label">{label}</p>
      <div className={`h-10 rounded-[10px] border border-line bg-surface px-3 flex items-center ${mono ? "mono-id" : ""}`}>{value}</div>
    </div>
  );
}

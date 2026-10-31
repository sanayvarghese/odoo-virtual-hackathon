"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { post, get, qs, ApiError } from "@/lib/api";
import { useAuth, type SessionUser } from "@/lib/auth-context";
import { useToast } from "@/components/toast";

const POLICY = [
  { test: (v: string) => v.length > 8, label: "More than 8 characters" },
  { test: (v: string) => /[A-Z]/.test(v), label: "An uppercase letter" },
  { test: (v: string) => /[a-z]/.test(v), label: "A lowercase letter" },
  { test: (v: string) => /[^A-Za-z0-9]/.test(v), label: "A special character" },
];

export default function SignupPage() {
  const router = useRouter();
  const { refresh, user, loading } = useAuth();
  const { toast } = useToast();
  const [form, setForm] = useState({
    name: "",
    companyName: "",
    email: "",
    password: "",
    phone: "",
    address: "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [emailState, setEmailState] = useState<"idle" | "checking" | "taken" | "free">("idle");

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm({ ...form, [k]: e.target.value });

  const available = POLICY.every((p) => p.test(form.password));

  // Already signed in? Straight to the portal.
  useEffect(() => {
    if (!loading && user) router.replace("/portal");
  }, [loading, user, router]);

  // live email availability — server-backed, debounced
  useEffect(() => {
    if (!/^\S+@\S+\.\S+$/.test(form.email)) {
      setEmailState("idle");
      return;
    }
    setEmailState("checking");
    const t = setTimeout(async () => {
      try {
        const res = await get<{ available: boolean }>(`/auth/email-available${qs({ email: form.email })}`);
        setEmailState(res.available ? "free" : "taken");
      } catch {
        setEmailState("idle");
      }
    }, 400);
    return () => clearTimeout(t);
  }, [form.email]);

  async function submit() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await post("/auth/register", {
        email: form.email.trim(),
        password: form.password,
        name: form.name.trim(),
        companyName: form.companyName.trim(),
        phone: form.phone.trim() || undefined,
        address: form.address.trim() || undefined,
      });
      await refresh();
      toast("success", "Account created");
      router.replace("/portal");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not create the account");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <h1 className="text-[24px] font-medium leading-tight">Create your account</h1>
      <p className="text-muted mt-1.5">
        A customer account on Brightloop — subscribe to plans, manage billing.
      </p>

      <form
        className="mt-6 space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <div>
          <label className="field-label" htmlFor="name">
            Your name
          </label>
          <input id="name" className="input" value={form.name} onChange={set("name")} required />
        </div>
        <div>
          <label className="field-label" htmlFor="company">
            Company name
          </label>
          <input
            id="company"
            className="input"
            value={form.companyName}
            onChange={set("companyName")}
            required
          />
        </div>
        <div>
          <label className="field-label" htmlFor="email">
            Work email
          </label>
          <input
            id="email"
            type="email"
            autoComplete="email"
            className="input"
            value={form.email}
            onChange={set("email")}
            required
          />
          {emailState === "taken" && <p className="text-xs text-negative mt-1">Already registered — sign in instead.</p>}
          {emailState === "free" && <p className="text-xs text-positive mt-1">Available.</p>}
        </div>
        <div>
          <label className="field-label" htmlFor="password">
            Password
          </label>
          <input
            id="password"
            type="password"
            autoComplete="new-password"
            className="input"
            value={form.password}
            onChange={set("password")}
            required
          />
          <ul className="mt-2 space-y-0.5">
            {POLICY.map((p) => {
              const ok = p.test(form.password);
              return (
                <li
                  key={p.label}
                  className={`text-xs flex items-center gap-1.5 ${ok ? "text-positive" : "text-faint"}`}
                >
                  <span className="inline-block w-3">{ok ? "✓" : "·"}</span>
                  {p.label}
                </li>
              );
            })}
          </ul>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="field-label" htmlFor="phone">
              Phone <span className="text-faint font-normal">optional</span>
            </label>
            <input id="phone" className="input" value={form.phone} onChange={set("phone")} />
          </div>
          <div>
            <label className="field-label" htmlFor="address">
              Address <span className="text-faint font-normal">optional</span>
            </label>
            <input id="address" className="input" value={form.address} onChange={set("address")} />
          </div>
        </div>

        {error && (
          <p className="text-sm text-negative" role="alert">
            {error}
          </p>
        )}

        <button type="submit" className="btn btn-primary w-full" disabled={busy || !available || emailState === "taken"}>
          {busy ? "Creating…" : "Create account"}
        </button>
      </form>

      <p className="text-sm text-muted mt-6">
        Already have an account?{" "}
        <Link href="/login" className="text-ink font-medium hover:underline">
          Sign in
        </Link>
      </p>
    </>
  );
}

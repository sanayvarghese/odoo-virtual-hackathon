"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { post, ApiError } from "@/lib/api";
import { useAuth, type SessionUser } from "@/lib/auth-context";
import { useToast } from "@/components/toast";

function LoginInner() {
  const router = useRouter();
  const { refresh, user, loading } = useAuth();
  const { toast } = useToast();
  const params = useSearchParams();
  const next = params.get("next") ?? "";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Already signed in? Straight to your home — the form is only for signed-out visitors.
  useEffect(() => {
    if (!loading && user) router.replace(next || (user.role === "customer" ? "/portal" : "/dashboard"));
  }, [loading, user, next, router]);

  function dest(role: string) {
    return next && next.startsWith("/") ? next : role === "customer" ? "/portal" : "/dashboard";
  }

  async function submit() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await post<{ user: SessionUser }>("/auth/login", { email, password });
      await refresh();
      toast("success", "Signed in");
      router.replace(dest(res.user.role));
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : "Could not sign in";
      setError(msg);
    } finally {
      setBusy(false);
    }
  }

  const DEMO = [
    { label: "Admin", email: "admin@brightloop.dev" },
    { label: "Staff", email: "staff@brightloop.dev" },
    { label: "Customer", email: "customer@brightloop.dev" },
  ];

  return (
    <>
      <h1 className="text-[24px] font-medium leading-tight">Sign in</h1>
      <p className="text-muted mt-1.5">Pick up where your billing left off.</p>

      <form
        className="mt-6 space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <div>
          <label className="field-label" htmlFor="email">
            Email
          </label>
          <input
            id="email"
            type="email"
            autoComplete="email"
            className="input"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </div>
        <div>
          <div className="flex items-baseline justify-between">
            <label className="field-label" htmlFor="password">
              Password
            </label>
            <Link href="/forgot-password" className="text-sm text-muted hover:text-ink">
              Forgot?
            </Link>
          </div>
          <input
            id="password"
            type="password"
            autoComplete="current-password"
            className="input"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </div>

        {error && (
          <p className="text-sm text-negative" role="alert">
            {error}
          </p>
        )}

        <button type="submit" className="btn btn-primary w-full" disabled={busy}>
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>

      <div className="mt-6 rounded-[6px] p-3" style={{ background: "#fafafa", border: "1px solid var(--color-rule)" }}>
        <p className="text-xs text-muted mb-2">Demo accounts — password Bright@2025</p>
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          {DEMO.map((d) => (
            <button
              key={d.email}
              className="text-xs mono-id text-muted hover:text-ink cursor-pointer"
              onClick={() => {
                setEmail(d.email);
                setPassword("Bright@2025");
              }}
            >
              {d.label}: {d.email}
            </button>
          ))}
        </div>
      </div>

      <p className="text-sm text-muted mt-6">
        New to Brightloop?{" "}
        <Link href="/signup" className="text-ink font-medium hover:underline">
          Create an account
        </Link>
      </p>
    </>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginInner />
    </Suspense>
  );
}

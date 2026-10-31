"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { post, ApiError } from "@/lib/api";

const POLICY = [
  { test: (v: string) => v.length > 8, label: "More than 8 characters" },
  { test: (v: string) => /[A-Z]/.test(v), label: "An uppercase letter" },
  { test: (v: string) => /[a-z]/.test(v), label: "A lowercase letter" },
  { test: (v: string) => /[^A-Za-z0-9]/.test(v), label: "A special character" },
];

function ResetInner() {
  const params = useSearchParams();
  const router = useRouter();
  const token = params.get("token") ?? "";
  const [password, setPassword] = useState("");
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const available = POLICY.every((p) => p.test(password));

  async function submit() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await post("/auth/reset", { token, password });
      setDone(true);
      setTimeout(() => router.replace("/login"), 1600);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not reset the password");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <h1 className="text-[24px] font-medium leading-tight">Choose a new password</h1>
      <p className="text-muted mt-1.5">
        {done ? "Password updated — taking you to sign in." : "This link is single-use and expires."}
      </p>

      {done ? (
        <Link href="/login" className="btn btn-primary w-full mt-6">
          Go to sign in
        </Link>
      ) : (
        <form
          className="mt-6 space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <div>
            <label className="field-label" htmlFor="password">
              New password
            </label>
            <input
              id="password"
              type="password"
              autoComplete="new-password"
              className="input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
            <ul className="mt-2 space-y-0.5">
              {POLICY.map((p) => {
                const ok = p.test(password);
                return (
                  <li key={p.label} className={`text-xs flex items-center gap-1.5 ${ok ? "text-positive" : "text-faint"}`}>
                    <span className="inline-block w-3">{ok ? "✓" : "·"}</span>
                    {p.label}
                  </li>
                );
              })}
            </ul>
          </div>
          {error && (
            <p className="text-sm text-negative" role="alert">
              {error}
            </p>
          )}
          <button type="submit" className="btn btn-primary w-full" disabled={busy || !available}>
            {busy ? "Updating…" : "Update password"}
          </button>
        </form>
      )}
    </>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense>
      <ResetInner />
    </Suspense>
  );
}

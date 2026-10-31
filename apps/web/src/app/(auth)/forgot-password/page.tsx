"use client";

import { useState } from "react";
import Link from "next/link";
import { post } from "@/lib/api";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (busy) return;
    setBusy(true);
    try {
      await post("/auth/forgot", { email: email.trim() });
    } finally {
      // Same message whether or not the account exists — no enumeration.
      setSent(true);
      setBusy(false);
    }
  }

  return (
    <>
      <h1 className="text-[24px] font-medium leading-tight">Reset your password</h1>
      <p className="text-muted mt-1.5">
        {sent
          ? `If an account exists for ${email}, a reset link is waiting in the dev mailbox (this demo runs without SMTP).`
          : "Enter your email and we'll send a reset link."}
      </p>

      {sent ? (
        <Link href="/mailbox" className="btn btn-primary w-full mt-6">
          Open the dev mailbox
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
            <label className="field-label" htmlFor="email">
              Email
            </label>
            <input
              id="email"
              type="email"
              className="input"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>
          <button type="submit" className="btn btn-primary w-full" disabled={busy}>
            {busy ? "Sending…" : "Send reset link"}
          </button>
        </form>
      )}

      <p className="text-sm text-muted mt-6">
        <Link href="/login" className="text-ink font-medium hover:underline">
          Back to sign in
        </Link>
      </p>
    </>
  );
}

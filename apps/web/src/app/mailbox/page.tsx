"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { get } from "@/lib/api";
import { dateTime } from "@/lib/format";
import { LoopMark } from "@/components/app-shell";

interface MailItem {
  id: number;
  userId: number;
  purpose: string;
  subject: string;
  body: string;
  link: string | null;
  createdAt: string;
  email: string;
}

/** Dev mailbox — the backend "sends email" here instead of SMTP. Links carry the raw token. */
export default function MailboxPage() {
  const [items, setItems] = useState<MailItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<number | null>(null);

  useEffect(() => {
    get<{ items: MailItem[] }>("/dev/mailbox")
      .then((r) => {
        setItems(r.items);
        if (r.items[0]) setOpenId(r.items[0].id);
      })
      .catch(() => setError("Mailbox is served by the API on :4000 — is it running?"));
  }, []);

  return (
    <div className="min-h-screen flex flex-col items-center px-4 py-10">
      <Link href="/" className="flex items-center gap-2.5 mb-1">
        <LoopMark size={22} />
        <span className="font-medium text-[15px] tracking-tight">Brightloop</span>
      </Link>
      <h1 className="text-[20px] font-medium mt-3">Dev mailbox</h1>
      <p className="text-muted text-sm mt-1 mb-6">
        Every verification / reset email in this demo lands here — the link contains the raw token.
      </p>

      {error ? (
        <p className="text-sm text-negative">{error}</p>
      ) : items === null ? (
        <p className="text-sm text-muted">Loading…</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-muted">No mail yet. Sign up or reset a password to trigger one.</p>
      ) : (
        <div className="w-full max-w-[680px] space-y-2">
          {items.map((m) => (
            <div key={m.id} className="card">
              <button
                className="w-full flex items-center justify-between px-4 py-3 text-left cursor-pointer"
                onClick={() => setOpenId(openId === m.id ? null : m.id)}
              >
                <div className="min-w-0">
                  <p className="text-sm truncate">{m.subject}</p>
                  <p className="text-xs text-faint mt-0.5">
                    {m.email} · {m.purpose.replace(/_/g, " ")} · {dateTime(m.createdAt)}
                  </p>
                </div>
                <span className="text-xs text-faint shrink-0 ml-3">{openId === m.id ? "hide" : "open"}</span>
              </button>
              {openId === m.id && (
                <div className="px-4 pb-4 pt-1" style={{ borderTop: "1px solid var(--color-rule)" }}>
                  <p className="text-sm text-muted mt-3 whitespace-pre-wrap">{m.body}</p>
                  {m.link && (
                    <a href={m.link} className="btn btn-primary mt-3">
                      Follow the token link
                    </a>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <Link href="/login" className="text-sm text-muted hover:text-ink mt-8">
        Back to sign in
      </Link>
    </div>
  );
}

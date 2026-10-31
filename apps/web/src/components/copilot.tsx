"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Bot, X, Paperclip, ArrowUp } from "lucide-react";
import { useAuth, isStaff } from "@/lib/auth-context";
import { useToast } from "@/components/toast";
import { API_BASE } from "@/lib/api";

/**
 * Floating AI copilot dock.
 *  - Questions stream from POST /api/ai/chat (Next rewrite → API SSE) with
 *    role-scoped tools over the local Ollama model. JSON body only — the SSE
 *    route parses JSON, not multipart.
 *  - Staff can attach a .xlsx/.csv/.txt: it goes to the bulk-import endpoint
 *    (parse → map → stage → preview); nothing is committed from the dock.
 */

interface ChatMsg {
  role: "user" | "assistant";
  content: string;
  attachment?: { name: string; size: number };
}

type ImportEntity = "product" | "plan" | "customer";

const QUICK_PROMPTS_STAFF = [
  "What are this month's KPIs?",
  "Show me overdue invoices",
  "Which active subscriptions used SEATS15?",
];

const QUICK_PROMPTS_CUSTOMER = [
  "Which of my subscriptions renew next?",
  "Do I have any unpaid invoices?",
  "What plans would fit a 12-person team?",
];

interface ImportPreviewSummary {
  jobId: string;
  totalRows: number;
  validCount: number;
  invalidCount: number;
}

export function CopilotDock() {
  const { user } = useAuth();
  const staff = isStaff(user?.role);
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [toolNotes, setToolNotes] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [input, setInput] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [entity, setEntity] = useState<ImportEntity>("product");
  const bodyRef = useRef<HTMLDivElement>(null);
  const { toast } = useToast();

  const scrollToEnd = useCallback(() => {
    requestAnimationFrame(() => {
      bodyRef.current?.scrollTo({ top: bodyRef.current.scrollHeight });
    });
  }, []);

  useEffect(scrollToEnd, [messages, scrollToEnd]);

  function csrfHeader(): Record<string, string> {
    const m = document.cookie.match(/(?:^|;\s*)bl_csrf=([^;]*)/);
    return m ? { "X-CSRF-Token": decodeURIComponent(m[1]!) } : {};
  }

  /** Bulk import path: parse → stage → link to preview. Nothing is committed here. */
  async function runImport(attached: File, question: string) {
    const form = new FormData();
    form.set("file", attached);
    const res = await fetch(`${API_BASE}/ai/import?entity=${entity}`, {
      method: "POST",
      headers: csrfHeader(),
      credentials: "include",
      body: form,
    });
    const json = await res.json().catch(() => undefined);
    if (!res.ok) {
      const msg = json?.error?.message ?? `Import staging failed (${res.status})`;
      setMessages((m) => [...m.slice(0, -1), { role: "assistant", content: `⚠ ${msg}` }]);
      return;
    }
    const p = json as ImportPreviewSummary;
    const kind = entity === "product" ? "products" : entity === "plan" ? "plans" : "customers";
    let text = `Staged ${p.validCount} of ${p.totalRows} ${kind} from “${attached.name}”.`;
    if (p.invalidCount > 0) {
      text += ` ${p.invalidCount} row${p.invalidCount === 1 ? " is" : "s are"} invalid and will be skipped unless forced.`;
    }
    text += `\n\nNothing is written yet — open Products → Bulk import to review the rows and press Commit. Job ${p.jobId}.`;
    if (question.trim()) {
      text = `You asked: “${question.trim()}” — I staged the import instead of answering directly.\n\n${text}`;
    }
    setMessages((m) => [...m.slice(0, -1), { role: "assistant", content: text }]);
    toast("info", "Import staged — review the rows before committing");
  }

  /** Chat path: JSON body → SSE stream of token / tool_use / tool_result events. */
  async function runChat(history: ChatMsg[]) {
    const res = await fetch("/api/ai/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...csrfHeader() },
      credentials: "include",
      body: JSON.stringify({ messages: history.map((m) => ({ role: m.role, content: m.content })) }),
    });
    if (!res.ok || !res.body) {
      let msg = "The copilot could not be reached. Is the API running?";
      try {
        const j = await res.json();
        if (j?.error?.message) msg = j.error.message;
      } catch {
        /* keep default */
      }
      setMessages((m) => [...m.slice(0, -1), { role: "assistant", content: msg }]);
      return;
    }

    // SSE frames arrive as `event: <name>\ndata: <json>\n\n` — track the event
    // name from its own line; the data payload carries the fields.
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let acc = "";
    let buf = "";
    let currentEvent = "";

    const flushAcc = () =>
      setMessages((m) => [...m.slice(0, -1), { role: "assistant", content: acc }]);

    const handle = (raw: string) => {
      let ev: Record<string, unknown>;
      try {
        ev = JSON.parse(raw);
      } catch {
        return;
      }
      switch (currentEvent) {
        case "token":
          acc += String(ev.t ?? ev.text ?? "");
          flushAcc();
          break;
        case "tool_use":
          setToolNotes((n) => [...n, `→ ${String(ev.name ?? "tool")}`]);
          break;
        case "tool_result":
          setToolNotes((n) => [...n, `✓ ${String(ev.name ?? "your data")}`]);
          break;
        case "error":
          acc += `\n\n${String(ev.message ?? "Something went wrong.")}`;
          flushAcc();
          break;
        default:
          break;
      }
      currentEvent = "";
    };

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let nl: number;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).trimEnd();
        buf = buf.slice(nl + 1);
        if (line.startsWith("event:")) {
          currentEvent = line.slice(6).trim();
        } else if (line.startsWith("data:")) {
          handle(line.slice(5).trim());
        }
        // blank line = frame separator; parser state resets in handle()
      }
    }
    if (!acc.trim()) {
      acc = "I did not get an answer on that one — try rephrasing.";
      flushAcc();
    }
  }

  async function send() {
    const text = input.trim();
    if ((!text && !file) || busy) return;
    setBusy(true);
    setInput("");

    const userMsg: ChatMsg = {
      role: "user",
      content: text || (file ? `Import this file: ${file.name}` : ""),
      attachment: file ? { name: file.name, size: file.size } : undefined,
    };
    setMessages((m) => [...m, userMsg, { role: "assistant", content: "" }]);
    setToolNotes([]);

    try {
      if (file) {
        await runImport(file, text);
      } else {
        await runChat([...messages, userMsg]);
      }
    } catch {
      setMessages((m) => [
        ...m.slice(0, -1),
        { role: "assistant", content: "Connection interrupted. Try again in a moment." },
      ]);
      toast("error", "Copilot request failed");
    } finally {
      setBusy(false);
      setFile(null);
      scrollToEnd();
    }
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-6 right-6 z-[80] flex items-center gap-2 h-11 pl-3.5 pr-4 rounded-full bg-ink-2 text-white text-sm font-medium shadow-[0_10px_30px_rgba(0,0,0,0.18)] hover:bg-[#2b2b2b] transition-colors cursor-pointer"
      >
        <Bot size={17} strokeWidth={1.5} />
        Ask Brightloop AI
      </button>
    );
  }

  return (
    <div className="fixed bottom-5 right-5 z-[80] w-[400px] max-h-[660px] flex flex-col card overflow-hidden shadow-[0_16px_48px_rgba(0,0,0,0.16)]">
      <div className="flex items-center justify-between px-4 py-3" style={{ borderBottom: "1px solid var(--color-rule)" }}>
        <div className="flex items-center gap-2">
          <Bot size={16} strokeWidth={1.5} />
          <span className="text-sm font-medium">Brightloop AI</span>
          <span className="pill pill-neutral">runs local</span>
        </div>
        <button onClick={() => setOpen(false)} className="text-faint hover:text-ink cursor-pointer" aria-label="Close">
          <X size={16} />
        </button>
      </div>

      <div ref={bodyRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-3 min-h-[240px]">
        {messages.length === 0 && (
          <div className="pt-2 space-y-3">
            <p className="text-sm text-muted">I answer from your Brightloop data. Try one of these:</p>
            {(staff ? QUICK_PROMPTS_STAFF : QUICK_PROMPTS_CUSTOMER).map((q) => (
              <button
                key={q}
                onClick={() => setInput(q)}
                className="block w-full text-left text-sm card px-3 py-2 hover:bg-[#fafafa] cursor-pointer"
              >
                {q}
              </button>
            ))}
            {staff && (
              <p className="text-xs text-faint">
                Tip: attach a .xlsx / .csv / .txt to stage a bulk import of products, plans or customers.
              </p>
            )}
          </div>
        )}

        {messages.map((m, i) => (
          <div key={i} className={`text-sm leading-relaxed ${m.role === "user" ? "text-right" : ""}`}>
            <div
              className={
                m.role === "user"
                  ? "inline-block rounded-[6px] px-2.5 py-1.5 text-left"
                  : "whitespace-pre-wrap min-h-[1em] text-left"
              }
              style={m.role === "user" ? { background: "#e9e9e9", maxWidth: "92%" } : undefined}
            >
              {m.attachment && (
                <div className="text-xs text-muted flex items-center gap-1 mb-1">
                  <Paperclip size={12} /> {m.attachment.name}
                </div>
              )}
              {m.content || (busy && i === messages.length - 1 ? <span className="text-faint">thinking…</span> : "")}
            </div>
          </div>
        ))}

        {toolNotes.length > 0 && (
          <div className="text-xs text-faint flex flex-wrap gap-x-3">
            {toolNotes.slice(-3).map((n, i) => (
              <span key={i}>{n}</span>
            ))}
          </div>
        )}
      </div>

      <div className="px-3 py-2.5" style={{ borderTop: "1px solid var(--color-rule)" }}>
        {file && (
          <div className="flex items-center gap-2 text-xs text-muted mb-2">
            <Paperclip size={12} />
            <span className="truncate flex-1">{file.name}</span>
            <select
              value={entity}
              onChange={(e) => setEntity(e.target.value as ImportEntity)}
              className="text-xs border border-line rounded-[4px] px-1 py-0.5 bg-surface"
              aria-label="Import as"
            >
              <option value="product">as products</option>
              <option value="plan">as plans</option>
              <option value="customer">as customers</option>
            </select>
            <button className="hover:text-negative cursor-pointer" onClick={() => setFile(null)}>
              remove
            </button>
          </div>
        )}
        <div className="flex items-center gap-1.5">
          {staff && (
            <label
              className="shrink-0 p-2 rounded-full hover:bg-[#ededed] cursor-pointer"
              title="Attach .xlsx/.csv/.txt to stage a bulk import"
            >
              <Paperclip size={15} strokeWidth={1.5} />
              <input
                type="file"
                className="hidden"
                accept=".xlsx,.xls,.csv,.txt"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
            </label>
          )}
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
            placeholder="Ask about subscriptions, invoices…"
            className="input h-9"
            disabled={busy}
          />
          <button
            onClick={() => void send()}
            disabled={busy || (!input.trim() && !file)}
            className="shrink-0 p-2 rounded-full bg-ink-2 text-white disabled:opacity-40 cursor-pointer"
            aria-label="Send"
          >
            <ArrowUp size={15} />
          </button>
        </div>
      </div>
    </div>
  );
}

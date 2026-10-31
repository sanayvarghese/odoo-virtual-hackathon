"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Bot, X, Paperclip, ArrowUp } from "lucide-react";
import { useAuth, isStaff } from "@/lib/auth-context";
import { useToast } from "@/components/toast";
import { post, API_BASE, ApiError } from "@/lib/api";

/**
 * Floating AI copilot dock — a functional chat, not a text box:
 *  - answers stream from POST /api/ai/chat (SSE, local Ollama, role-scoped tools)
 *  - **bold** and markdown tables in answers render properly
 *  - staged imports show real [Review] / [Commit] buttons that hit the API
 *  - typing "commit" commits the staged job; "open invoices" navigates
 */

interface ChatMsg {
  role: "user" | "assistant";
  content: string;
  attachment?: { name: string; size: number };
  actions?: MsgAction[];
  table?: { head: string[]; rows: string[][] };
}

type MsgAction =
  | { kind: "commit"; jobId: string; valid: number; invalid: number; entity: string }
  | { kind: "link"; href: string; label: string };

type ImportEntity = "product" | "plan" | "customer";

const PAGE_HREF: Record<string, string> = {
  dashboard: "/dashboard",
  overview: "/dashboard",
  subscriptions: "/subscriptions",
  subscription: "/subscriptions",
  invoices: "/invoices",
  invoice: "/invoices",
  payments: "/payments",
  payment: "/payments",
  products: "/products",
  product: "/products",
  plans: "/plans",
  plan: "/plans",
  customers: "/customers",
  customer: "/customers",
  staff: "/staff",
  taxes: "/taxes",
  reports: "/reports",
  settings: "/settings",
  mailbox: "/mailbox",
  portal: "/portal",
};

const QUICK_PROMPTS_STAFF = [
  "What are this month's KPIs?",
  "Show me overdue invoices as a table",
  "Draft a quotation for Sunrise Retail on Brightloop CRM",
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

interface TablePreview {
  rows: { row: number; ok: boolean; errors: string[]; data: Record<string, unknown> }[];
  columns: Record<string, string | null>;
}

/** Heuristic: does pasted text look like a table (a header + data rows)? */
function looksTabular(text: string): boolean {
  const lines = text.trim().split("\n").filter((l) => l.trim());
  if (lines.length < 2) return false;
  const aliases = ["name", "sku", "price", "kind", "type", "notes", "description", "email", "company", "contact", "interval", "amount", "quantity"];
  const cells = lines[0]!.toLowerCase().split(/[,\t;]/).map((c) => c.trim());
  return cells.filter((c) => aliases.some((a) => c === a)).length >= 2;
}

/** Minimal markdown: **bold**, `code`, and | pipe tables |. */
function RichText({ text }: { text: string }) {
  const lines = text.split("\n");
  const out: React.ReactNode[] = [];
  let table: string[][] = [];

  const flushTable = (key: string) => {
    if (table.length === 0) return;
    const rows = table.filter((r) => !r.every((c) => /^[-: ]*$/.test(c) && c.length > 0));
    const [head, ...body] = rows;
    out.push(
      <div key={key} className="my-2 overflow-x-auto rounded-[6px]" style={{ border: "1px solid var(--color-line)" }}>
        <table className="btable" style={{ fontSize: 13 }}>
          <thead>
            <tr>{head?.map((c, i) => <th key={i}>{c}</th>)}</tr>
          </thead>
          <tbody>
            {body.map((r, ri) => (
              <tr key={ri}>{r.map((c, ci) => <td key={ci}>{inline(c)}</td>)}</tr>
            ))}
          </tbody>
        </table>
      </div>,
    );
    table = [];
  };

  lines.forEach((line, li) => {
    if (/^\s*\|.*\|\s*$/.test(line)) {
      table.push(
        line
          .trim()
          .slice(1, -1)
          .split("|")
          .map((c) => c.trim()),
      );
      return;
    }
    flushTable(`t${li}`);
    if (line.trim() === "") {
      out.push(<div key={li} className="h-2" />);
      return;
    }
    out.push(<p key={li} className="min-h-[4px]">{inline(line)}</p>);
  });
  flushTable("t-end");

  return <div className="leading-relaxed">{out}</div>;
}

/** Inline markdown: **bold** and `code`. */
function inline(text: string): React.ReactNode[] {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).filter(Boolean);
  return parts.map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return <strong key={i} className="font-bold">{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith("`") && part.endsWith("`")) {
      return <code key={i} className="mono-id">{part.slice(1, -1)}</code>;
    }
    return <span key={i}>{part}</span>;
  });
}

export function CopilotDock() {
  const { user } = useAuth();
  const staff = isStaff(user?.role);
  const router = useRouter();
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

  function lastStaged(): MsgAction | null {
    for (let i = messages.length - 1; i >= 0; i--) {
      const a = messages[i]!.actions?.find((x) => x.kind === "commit");
      if (a) return a;
    }
    return null;
  }

  /** Commits a staged import job for real, then navigates to the list page. */
  async function commitStaged(action: Extract<MsgAction, { kind: "commit" }>) {
    try {
      const res = await post<{ inserted: number; skipped: number; entity: string }>(
        `/ai/import/${action.jobId}/commit`,
        { force: action.invalid > 0 },
      );
      setMessages((m) => [
        ...m,
        {
          role: "assistant",
          content: `✅ Committed **${res.inserted}** ${action.entity}${res.inserted === 1 ? "" : "s"} to the database${res.skipped ? `, skipped ${res.skipped} invalid row${res.skipped === 1 ? "" : "s"}` : ""}. Taking you to the list…`,
        },
      ]);
      toast("success", `Imported ${res.inserted} ${action.entity}(s)`);
      scrollToEnd();
      // land on the list that now holds the new rows
      setTimeout(
        () =>
          router.push(
            action.entity === "plan" ? "/plans" : action.entity === "customer" ? "/customers" : "/products",
          ),
        700,
      );
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : "Commit failed";
      setMessages((m) => [...m, { role: "assistant", content: `⚠ ${msg}` }]);
      toast("error", msg);
      scrollToEnd();
    }
  }

  /** Bulk import from PASTED text (the API maps headers, stages, previews). */
  async function runTextImport(text: string) {
    const res = await fetch(`${API_BASE}/ai/import?entity=${entity}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...csrfHeader() },
      credentials: "include",
      body: JSON.stringify({ text }),
    });
    const json = await res.json().catch(() => undefined);
    if (!res.ok) {
      const msg = json?.error?.message ?? `Import staging failed (${res.status})`;
      setMessages((m) => [...m.slice(0, -1), { role: "assistant", content: `⚠ ${msg}` }]);
      return;
    }
    presentPreview(json as ImportPreviewSummary & TablePreview);
  }

  /** Bulk import from an attached file. */
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
    presentPreview(json as ImportPreviewSummary & TablePreview, attached.name, question);
  }

  /** Renders the staged preview: table in the chat + Commit button. */
  function presentPreview(
    p: ImportPreviewSummary & { rows: { row: number; ok: boolean; errors: string[]; data: Record<string, unknown> }[]; columns: Record<string, string | null>; },
    filename?: string,
    question?: string,
  ) {
    const kind = entity === "product" ? "products" : entity === "plan" ? "plans" : "customers";
    const text = [
      filename ? `Staged **${p.validCount} of ${p.totalRows}** ${kind} from “${filename}”.` : `Staged **${p.validCount} of ${p.totalRows}** ${kind} from your paste.`,
      p.invalidCount > 0 ? ` ${p.invalidCount} row${p.invalidCount === 1 ? " is" : "s are"} invalid — committing imports only the valid ones.` : "",
      "\nHere is what will be written. Nothing is in the database until you commit:",
    ].join("");

    // beautified preview of exactly the staged rows
    const fields = Object.keys(p.columns ?? {}).filter((f) => p.columns[f] != null);
    const table = {
      head: [...fields, "status"],
      rows: (p.rows ?? []).map((r) => [
        ...fields.map((f) => {
          const v = r.data[f];
          return v == null || v === "" ? "—" : String(v);
        }),
        r.ok ? "✓ valid" : `⚠ ${r.errors[0]?.slice(0, 30) ?? "invalid"}`,
      ]),
    };

    setMessages((m) => [
      ...m.slice(0, -1),
      {
        role: "assistant",
        content: question?.trim() ? `You asked: “${question.trim()}” — I staged the import instead.\n\n${text}` : text,
        table,
        actions: [
          { kind: "commit", jobId: p.jobId, valid: p.validCount, invalid: p.invalidCount, entity },
          { kind: "link", href: entity === "plan" ? "/plans" : entity === "customer" ? "/customers" : "/products", label: "Review rows" },
        ],
      },
    ]);
    toast("info", `${p.validCount} ${kind} staged — press Commit when ready`);
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
        case "tool_use": {
          const name = String(ev.name ?? "");
          setToolNotes((n) => [...n, `→ ${name}`]);
          // client-side action: the model wants to change pages
          if (name === "go_to_page") {
            const page = String((ev.args as Record<string, unknown>)?.page ?? "").toLowerCase();
            const href = PAGE_HREF[page];
            if (href) {
              setMessages((m) => [
                ...m.slice(0, -1),
                {
                  role: "assistant",
                  content: acc ? acc : `Opening ${page} for you.`,
                  actions: [{ kind: "link", href, label: `Go to ${page}` }],
                },
              ]);
              router.push(href);
              scrollToEnd();
            }
          }
          break;
        }
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
      }
    }
    if (!acc.trim()) {
      acc = "I did not get an answer on that one — try rephrasing.";
      flushAcc();
    }
  }

  /** Typed intents handled locally — instant, no model round-trip. */
  function parseIntent(text: string): { kind: "commit" } | { kind: "navigate"; href: string; label: string } | null {
    const t = text.trim().toLowerCase();
    if (/^(commit|confirm)( the)?( staged)?( import| rows| changes)?$/.test(t) || /^commit (it|them|the (import|rows))$/.test(t)) {
      return lastStaged()?.kind === "commit" ? { kind: "commit" } : null;
    }
    const nav = t.match(/^(?:open|show|go to|take me to)\s+(?:the\s+)?([a-z ]+)$/);
    if (nav) {
      const key = nav[1]!.trim().replace(/page|screen|s$/, "").trim();
      const href = PAGE_HREF[key];
      if (href) return { kind: "navigate", href, label: `Go to ${key}` };
    }
    return null;
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

    // typed intents run locally (commit / navigate)
    if (!file && text) {
      const intent = parseIntent(text);
      if (intent?.kind === "commit") {
        const a = lastStaged() as Extract<MsgAction, { kind: "commit" }>;
        setMessages((m) => [...m, userMsg, { role: "assistant", content: `Committing ${a.valid} ${a.entity}(s)…` }]);
        scrollToEnd();
        await commitStaged(a);
        setBusy(false);
        return;
      }
      if (intent?.kind === "navigate") {
        setMessages((m) => [
          ...m,
          userMsg,
          { role: "assistant", content: `Opening it now.`, actions: [{ kind: "link", href: intent.href, label: intent.label }] },
        ]);
        router.push(intent.href);
        setBusy(false);
        return;
      }
    }

    setMessages((m) => [...m, userMsg, { role: "assistant", content: "" }]);
    setToolNotes([]);

    try {
      if (file) {
        await runImport(file, text);
      } else if (staff && looksTabular(text)) {
        // pasted a table → stage it instead of chatting about it
        await runTextImport(text);
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
    <div className="fixed bottom-5 right-5 z-[80] w-[440px] max-h-[680px] flex flex-col card overflow-hidden shadow-[0_16px_48px_rgba(0,0,0,0.16)]">
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

      <div ref={bodyRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-3 min-h-[260px]">
        {messages.length === 0 && (
          <div className="pt-2 space-y-3">
            <p className="text-sm text-muted">I answer from your data — and I can act. Try:</p>
            {(staff ? QUICK_PROMPTS_STAFF : QUICK_PROMPTS_CUSTOMER).map((q) => (
              <button
                key={q}
                onClick={() => setInput(q)}
                className="block w-full text-left text-sm card px-3 py-2 hover:bg-[#fafafa] cursor-pointer"
              >
                {q}
              </button>
            ))}
            <p className="text-xs text-faint">
              {staff
                ? "Attach a .xlsx/.csv/.txt to stage an import, then type “commit” — or press the button."
                : "Say “open my invoices” and I'll take you there."}
            </p>
          </div>
        )}

        {messages.map((m, i) => (
          <div key={i} className={`text-sm leading-relaxed ${m.role === "user" ? "text-right" : ""}`}>
            <div
              className={
                m.role === "user"
                  ? "inline-block rounded-[6px] px-2.5 py-1.5 text-left"
                  : "min-h-[1em] text-left"
              }
              style={m.role === "user" ? { background: "#e9e9e9", maxWidth: "92%" } : undefined}
            >
              {m.attachment && (
                <div className="text-xs text-muted flex items-center gap-1 mb-1">
                  <Paperclip size={12} /> {m.attachment.name}
                </div>
              )}
              {m.role === "assistant" ? (
                m.content ? <RichText text={m.content} /> : busy && i === messages.length - 1 ? <span className="text-faint">thinking…</span> : null
              ) : (
                m.content
              )}
              {m.table && (
                <div className="mt-2 overflow-x-auto rounded-[6px]" style={{ border: "1px solid var(--color-line)" }}>
                  <table className="btable" style={{ fontSize: 13 }}>
                    <thead>
                      <tr>{m.table.head.map((h, hi) => <th key={hi}>{h}</th>)}</tr>
                    </thead>
                    <tbody>
                      {m.table.rows.map((r, ri) => (
                        <tr key={ri} style={/⚠/.test(r[r.length - 1] ?? "") ? { background: "var(--color-negative-tint)" } : undefined}>
                          {r.map((c, ci) => <td key={ci}>{inline(c)}</td>)}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
            {m.actions && (
              <div className="flex flex-wrap gap-2 mt-2">
                {m.actions.map((a, ai) =>
                  a.kind === "commit" ? (
                    <button
                      key={ai}
                      className="btn btn-primary"
                      style={{ height: 30, fontSize: 13 }}
                      disabled={busy}
                      onClick={() => commitStaged(a)}
                    >
                      Commit {a.valid} {a.entity}{a.valid === 1 ? "" : "s"}{a.invalid > 0 ? ` (skip ${a.invalid})` : ""}
                    </button>
                  ) : (
                    <button
                      key={ai}
                      className="btn btn-outline"
                      style={{ height: 30, fontSize: 13 }}
                      onClick={() => {
                        router.push(a.href);
                        setOpen(false);
                      }}
                    >
                      {a.label}
                    </button>
                  ),
                )}
              </div>
            )}
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
            <button className="hover:text-negative cursor-pointer" onClick={() => setFile(null)}>
              remove
            </button>
          </div>
        )}
        <div className="flex items-center gap-1.5">
          {staff && (
            <select
              value={entity}
              onChange={(e) => setEntity(e.target.value as ImportEntity)}
              className="text-xs border border-line rounded-[4px] px-1 py-1.5 bg-surface shrink-0"
              aria-label="Import as"
              title="What pasted/uploaded tables become"
            >
              <option value="product">products</option>
              <option value="plan">plans</option>
              <option value="customer">customers</option>
            </select>
          )}
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
            placeholder="Ask, or type “commit” / “open invoices”"
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

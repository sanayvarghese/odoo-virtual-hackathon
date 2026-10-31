/**
 * Copilot agent — orchestrates the streaming chat loop between the local Ollama
 * model and the role-scoped tool registry. Events are written to the HTTP
 * response as Server-Sent Events:
 *   event: token        { t }          streamed answer text
 *   event: tool_use     { name, args } the model invoked a tool
 *   event: tool_result  { name, ok, rows } compact result (client shows a chip)
 *   event: done         { }
 */
import type { FastifyReply } from 'fastify';
import type { AuthedUser } from '../../plugins/auth.js';
import { ollamaChat, type OllamaMessage, type OllamaTool } from '../../lib/ollama.js';
import { runTool, toolsForRole } from './tools.js';
import { moneyToUi } from '../pricing.service.js';

const MAX_TOOL_LOOPS = 4;
const TOOL_RESULT_MAX = 4000; // chars fed back to the model per result

interface IncomingMessage {
  role: 'user' | 'assistant';
  content: string;
}

const todayFormatted = () => new Date().toLocaleDateString('en-IN', { dateStyle: 'long' });

function buildSystemPrompt(user: AuthedUser, kpiHint: string): string {
  const roleText =
    user.role === 'admin'
      ? "The user is the ADMIN: full access. They may ask for finance overviews, overdue lists, discounts, products, plans."
      : user.role === 'staff'
        ? 'The user is INTERNAL STAFF: day-to-day operations, billing and customer support. Read access for invoices/subs.'
        : "The user is a CUSTOMER: they can only see their OWN subscriptions and invoices. Never reveal, hint at or compute other customers' data.";
  return `You are Brightloop Copilot inside a subscription management platform.
${roleText}
Today: ${todayFormatted}.
Quick KPI snapshot: ${kpiHint}.

Rules:
- Answer briefly (3-6 sentences max unless a compact table list is genuinely useful). Money in rupees like ₹1,234.56.
- Use the provided tools for anything data-related — NEVER invent numbers. Cite the key figures from tool results.
- If a question needs data the tools don't provide, say in one line what is missing.
- Never paste raw SQL or JSON dumps; narrate results.
- For overdue chase requests, list invoice number, customer, amount, days overdue.`;
}

async function kpiSnapshot(user: AuthedUser): Promise<string> {
  const k = await runTool(user, 'get_kpis', {});
  if (!k.ok) return 'unavailable';
  const d = k.data as Record<string, unknown>;
  return [
    `active_subs=${d.active_subs}`,
    `MRR=${moneyToUi(Number(d.mrr_cents ?? 0))}`,
    `collected=${moneyToUi(Number(d.revenue_cents ?? 0))}`,
    `overdue_invoices=${d.overdue_invoices}`,
    `open_to_collect=${moneyToUi(Number(d.outstanding_cents ?? 0))}`,
  ].join(', ');
}

/** compact SSE writer */
function sse(reply: FastifyReply, event: string, data: unknown) {
  reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

export async function streamCopilot(
  reply: FastifyReply,
  user: AuthedUser,
  history: IncomingMessage[],
): Promise<void> {
  reply.raw.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
  });

  try {
    const kpiHint = await kpiSnapshot(user);
    const tools: OllamaTool[] = toolsForRole(user.role);

    const messages: OllamaMessage[] = [
      { role: 'system', content: buildSystemPrompt(user, kpiHint) },
      ...history
        .slice(-10)
        .map<Partial<OllamaMessage>>((m) => ({ role: m.role, content: m.content.slice(0, 4000) })),
    ] as OllamaMessage[];

    for (let loop = 0; loop < MAX_TOOL_LOOPS; loop++) {
      let answerText = '';
      let toolCalls: Array<{ name: string; arguments: Record<string, unknown> }> | null = null;

      for await (const chunk of ollamaChat(messages as OllamaMessage[], { tools })) {
        if (chunk.contentDelta) {
          answerText += chunk.contentDelta;
          sse(reply, 'token', { t: chunk.contentDelta });
        }
        if (chunk.toolCalls?.length) {
          toolCalls = chunk.toolCalls;
          break; // pause text streaming; execute tools, then re-ask
        }
      }

      if (!toolCalls?.length) break;

      // expose a tiny trace of what the assistant "decided" this round
      if (answerText.trim()) {
        messages.push({ role: 'assistant', content: answerText.slice(-2000) });
      } else {
        messages.push({
          role: 'assistant',
          content: `[calls tools: ${toolCalls.map((c) => c.name).join(', ')}]`,
        });
      }

      answerText = '';
      for (const call of toolCalls) {
        sse(reply, 'tool_use', { name: call.name, args: call.arguments });
        const result = await runTool(user, call.name, call.arguments);
        const compact = JSON.stringify(result.data ?? { error: result.error });
        sse(reply, 'tool_result', {
          name: call.name,
          ok: result.ok,
          rows: Array.isArray(result.data) ? result.data.length : undefined,
        });
        messages.push({
          role: 'tool',
          tool_name: call.name,
          content: compact.slice(0, TOOL_RESULT_MAX),
        });
      }
    }

    sse(reply, 'done', {});
    reply.raw.end();
  } catch (e) {
    try {
      sse(reply, 'error', { message: (e as Error).message });
      reply.raw.end();
    } catch {
      /* socket already gone */
    }
  }
}

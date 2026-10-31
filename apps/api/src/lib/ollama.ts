/**
 * Ollama client — talks to the LOCAL model server (no cloud, no API keys).
 * Uses the native /api/chat (supports `think:false` — qwen3.5 answers ~10 faster
 * than with its reasoning mode on, and tool calling works natively).
 *
 * Model is configurable via OLLAMA_MODEL (default qwen3.5:9b-q4_K_M).
 */
import { env } from '../env.js';

export interface OllamaMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_name?: string;
  tool_call_id?: string;
}

export interface OllamaToolFunction {
  name: string;
  description: string;
  parameters: Record<string, unknown>; // JSON schema
}

export interface OllamaTool {
  type: 'function';
  function: OllamaToolFunction;
}

interface StreamChunk {
  contentDelta?: string;
  toolCalls?: Array<{ name: string; arguments: Record<string, unknown> }>;
}

type ChatOpts = {
  tools?: OllamaTool[];
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
};

/** Streams chat completion; yields text deltas and tool-call bundles. */
export async function* ollamaChat(
  messages: OllamaMessage[],
  opts: ChatOpts = {},
): AsyncGenerator<StreamChunk> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 120_000);
  try {
    const res = await fetch(`${env.OLLAMA_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        model: env.OLLAMA_MODEL,
        stream: true,
        think: false, // speed: skip reasoning chain
        messages,
        ...(opts.tools && opts.tools.length > 0 ? { tools: opts.tools } : {}),
        options: {
          temperature: opts.temperature ?? 0.2,
          num_ctx: 8192,
          ...(opts.maxTokens ? { num_predict: opts.maxTokens } : {}),
        },
      }),
    });
    if (!res.ok || !res.body) {
      const text = await res.text().catch(() => '');
      throw new Error(`Ollama error ${res.status}: ${text.slice(0, 200)}`);
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (!line) continue;
        let parsed: {
          message?: { content?: string; tool_calls?: Array<{ function: { name: string; arguments: unknown } }> };
          done?: boolean;
          error?: string;
        };
        try {
          parsed = JSON.parse(line);
        } catch {
          continue; // partial line, ignore
        }
        if (parsed.error) throw new Error(`Ollama: ${parsed.error}`);
        if (parsed.message?.content) {
          yield { contentDelta: parsed.message.content };
        }
        if (parsed.message?.tool_calls?.length) {
          yield {
            toolCalls: parsed.message.tool_calls.map((tc) => ({
              name: tc.function.name,
              arguments: (tc.function.arguments ?? {}) as Record<string, unknown>,
            })),
          };
        }
        if (parsed.done) return;
      }
    }
  } finally {
    clearTimeout(timer);
  }
}

/** One-shot completion (no streaming) — used for structured JSON asks (import mapping) */
export async function ollamaComplete(messages: OllamaMessage[], opts: ChatOpts = {}): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 120_000);
  try {
    const res = await fetch(`${env.OLLAMA_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        model: env.OLLAMA_MODEL,
        stream: false,
        think: false,
        format: 'json', // hard-structured output (NDJSON json mode)
        messages,
        options: { temperature: opts.temperature ?? 0, num_ctx: 8192, ...(opts.maxTokens ? { num_predict: opts.maxTokens } : {}) },
      }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Ollama error ${res.status}: ${text.slice(0, 200)}`);
    }
    const data = (await res.json()) as { message?: { content?: string } };
    return data.message?.content ?? '';
  } finally {
    clearTimeout(timer);
  }
}

export async function ollamaHealth(): Promise<{ ok: boolean; model: string; detail?: string }> {
  try {
    const res = await fetch(`${env.OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) return { ok: false, model: env.OLLAMA_MODEL, detail: `status ${res.status}` };
    const data = (await res.json()) as { models?: Array<{ name: string }> };
    const found = data.models?.some((m) => m.name === env.OLLAMA_MODEL);
    return { ok: true, model: env.OLLAMA_MODEL, detail: found ? 'model available' : 'model NOT pulled — run: ollama pull ' + env.OLLAMA_MODEL };
  } catch (e) {
    return { ok: false, model: env.OLLAMA_MODEL, detail: (e as Error).message };
  }
}

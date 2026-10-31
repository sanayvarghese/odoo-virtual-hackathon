/**
 * API client for the Brightloop Fastify backend.
 * - Same-origin dev: API runs on :4000, cookies are SameSite=Lax so
 *   `credentials: "include"` carries bl_session + bl_csrf.
 * - Every state-changing call sends X-CSRF-Token from the bl_csrf cookie
 *   (double-submit CSRF, validated server-side).
 * - Errors arrive as { error: { message, code, details? } } — mapped to
 *   ApiError so UI code can toast one message.
 */

export const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:4000/api/v1";

export type ApiErrorCode =
  | "validation_error"
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "conflict"
  | "business_rule";

export class ApiError extends Error {
  code: ApiErrorCode | "unknown";
  status: number;
  details?: unknown;
  constructor(status: number, code: ApiErrorCode | "unknown", message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

function readCookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  const m = document.cookie.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
  return m ? decodeURIComponent(m[1]) : null;
}

type RequestInitEx = Omit<RequestInit, "body"> & { body?: unknown };

async function request<T>(path: string, init: RequestInitEx): Promise<T> {
  const { body, ...rest } = init;
  const method = (rest.method ?? "GET").toUpperCase();
  const headers = new Headers(rest.headers);
  if (body !== undefined && !(body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
  }
  const csrf = readCookie("bl_csrf");
  if (csrf && !["GET", "HEAD", "OPTIONS"].includes(method)) {
    headers.set("X-CSRF-Token", csrf);
  }

  const res = await fetch(`${API_BASE}${path}`, {
    ...rest,
    method,
    headers,
    credentials: "include",
    body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body),
    // never let Next cache API calls
    cache: "no-store",
  });

  if (res.status === 204) return undefined as T;

  const json = await res.json().catch(() => undefined);

  if (!res.ok) {
    const err = (json as { error?: { message?: string; code?: string; details?: unknown } })?.error;
    throw new ApiError(
      res.status,
      (err?.code as ApiErrorCode) ?? "unknown",
      err?.message ?? `Request failed (${res.status})`,
      err?.details,
    );
  }
  return json as T;
}

export function get<T>(path: string): Promise<T> {
  return request<T>(path, { method: "GET" });
}

export function post<T>(path: string, body?: unknown): Promise<T> {
  return request<T>(path, { method: "POST", body: body ?? {} });
}

export function patch<T>(path: string, body?: unknown): Promise<T> {
  return request<T>(path, { method: "PATCH", body: body ?? {} });
}

export function put<T>(path: string, body?: unknown): Promise<T> {
  return request<T>(path, { method: "PUT", body: body ?? {} });
}

export function del<T>(path: string): Promise<T> {
  return request<T>(path, { method: "DELETE" });
}

export { request };

export function qs(params: Record<string, string | number | boolean | undefined | null>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== "") sp.set(k, String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : "";
}

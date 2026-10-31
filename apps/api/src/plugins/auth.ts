/**
 * Session auth:
 *  - opaque random session token in httpOnly cookie (SameSite=Lax, web:3000 -> api:4000 is same-site)
 *  - DB stores sha256(token); revocation = delete row
 *  - request.user is loaded in the decorateRequest preHandler hook
 *  - CSRF: double-submit token; state-changing requests must send X-CSRF-Token matching cookie
 *  - RBAC: requireRole(...) as preHandler on routes
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { User } from '../db/schema.js';
import { db } from '../db/client.js';
import { sessions, users } from '../db/schema.js';
import { and, eq, gt, isNull } from 'drizzle-orm';
import { forbidden, unauthorized } from '../lib/errors.js';

export const SESSION_COOKIE = 'bl_session';
export const CSRF_COOKIE = 'bl_csrf';

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function newSessionToken(): string {
  return randomBytes(32).toString('base64url');
}

export interface AuthedUser {
  id: number;
  email: string;
  name: string;
  role: User['role'];
  emailVerified: boolean;
  sessionId: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    user?: AuthedUser;
    csrfValidate: () => void;
  }
}

export async function authDecorators(app: import('fastify').FastifyInstance) {
  // Decorators used by routes
  app.decorateRequest('user');
  app.decorateRequest('csrfValidate');

  app.addHook('preHandler', async (req) => {
    const token = req.cookies?.[SESSION_COOKIE];
    req.csrfValidate = () => {
      const cookieToken = req.cookies?.[CSRF_COOKIE];
      const headerToken = req.headers['x-csrf-token'];
      const method = req.method.toUpperCase();
      if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return;
      if (!cookieToken || !headerToken || !safeEqual(String(cookieToken), String(headerToken))) {
        throw forbidden('Invalid or missing CSRF token. Refresh the page and try again.');
      }
    };

    if (!token) return;
    const rows = await db
      .select({
        sessionId: sessions.id,
        role: users.role,
        email: users.email,
        name: users.name,
        userId: users.id,
        emailVerified: users.emailVerified,
        isActive: users.isActive,
      })
      .from(sessions)
      .innerJoin(users, eq(users.id, sessions.userId))
      .where(
        and(
          eq(sessions.tokenHash, hashToken(token)),
          gt(sessions.expiresAt, new Date()),
          isNull(sessions.revokedAt),
        ),
      )
      .limit(1);
    const row = rows[0];
    if (!row || !row.isActive) return;
    req.user = {
      id: row.userId,
      email: row.email,
      name: row.name,
      role: row.role,
      emailVerified: row.emailVerified,
      sessionId: row.sessionId,
    };
  });
}

export function requireAuth(req: FastifyRequest): AuthedUser {
  if (!req.user) throw unauthorized();
  return req.user;
}

/** Fastify hook variant: guards a route, requires any authenticated user */
export const requireAuthHook: (req: FastifyRequest, reply: FastifyReply) => Promise<void> = async (
  req,
) => {
  requireAuth(req);
};

export function requireRole(
  ...roles: User['role'][]
): (req: FastifyRequest, reply: FastifyReply) => Promise<void> {
  return async (req, _reply) => {
    const user = requireAuth(req);
    if (roles.length > 0 && !roles.includes(user.role)) {
      throw forbidden('Your role does not have access to this resource.');
    }
  };
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/** Sets the session cookie + returns csrf token (stored in cookie too, readable by JS) */
export async function createSession(
  userId: number,
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<{ token: string; csrf: string; expiry: Date }> {
  const token = newSessionToken();
  const csrf = randomBytes(16).toString('base64url');
  const expiry = new Date(Date.now() + (Number(process.env.SESSION_TTL_DAYS ?? 30)) * 24 * 3600 * 1000);
  await db.insert(sessions).values({
    userId,
    tokenHash: hashToken(token),
    expiresAt: expiry,
    ip: req.ip,
    userAgent: req.headers['user-agent'] ?? null,
  });
  reply.setCookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    secure: false, // local demo; flip behind TLS / production
    expires: expiry,
  });
  reply.setCookie(CSRF_COOKIE, csrf, {
    httpOnly: false, // read by client JS to send as header
    sameSite: 'lax',
    path: '/',
    secure: false,
    expires: expiry,
  });
  return { token, csrf, expiry };
}

export async function destroySession(token: string | undefined) {
  if (!token) return;
  await db
    .update(sessions)
    .set({ revokedAt: new Date() })
    .where(eq(sessions.tokenHash, hashToken(token)));
}

import type { FastifyInstance } from 'fastify';
import { and, eq, gt, isNull, sql } from 'drizzle-orm';
import { hash as argonHash, verify as argonVerify } from '@node-rs/argon2';
import { z } from 'zod';

/** case-insensitive email comparison helper */
const sqlLower = (col: typeof users.email) => sql`lower(${col})`;

import { db } from '../db/client.js';
import { customers, emailTokens, users } from '../db/schema.js';
import { AppError, badRequest, notFound } from '../lib/errors.js';
import { emailSchema, nameSchema, passwordSchema } from '../lib/validators.js';
import { sendTokenEmail, sendMessage } from '../lib/mailbox.js';
import {
  createSession,
  destroySession,
  hashToken,
  requireAuth,
  SESSION_COOKIE,
} from '../plugins/auth.js';

const ARGON_OPTS = { memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;

export default async function authRoutes(app: FastifyInstance) {
  /* ------------------------------------------------------------- register */
  app.post(
    '/register',
    {
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
      schema: { tags: ['auth'] },
    },
    async (req, reply) => {
      const parsed = registerSchema.safeParse(req.body);
      if (!parsed.success) throw ZodFail(parsed.error);
      const { email, password, name, companyName, phone, address } = parsed.data;

      const existing = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(sqlLower(users.email), email.toLowerCase()))
        .limit(1);
      if (existing.length > 0) {
        throw new AppError('conflict', 'An account with this email already exists.');
      }

      const passwordHash = await argonHash(password, ARGON_OPTS);
      const created = await db.transaction(async (tx) => {
        const [user] = await tx
          .insert(users)
          .values({ email, passwordHash, name, role: 'customer', emailVerified: false })
          .returning();
        const [customer] = await tx
          .insert(customers)
          .values({
            userId: user!.id,
            companyName,
            contactName: name,
            phone: phone ?? null,
            address: address ?? null,
          })
          .returning();
        return { user: user!, customer: customer! };
      });

      await sendTokenEmail(created.user.id, email, 'verify_email');
      const session = await createSession(created.user.id, req, reply);
      return reply.status(201).send({
        user: publicUser(created.user),
        customer: created.customer,
        csrf: session.csrf,
        message: 'Account created. Check the dev mailbox to verify your email.',
      });
    },
  );

  /* ----------------------------------------------------------------- login */
  app.post(
    '/login',
    {
      config: { rateLimit: { max: 8, timeWindow: '1 minute' } },
      schema: { tags: ['auth'] },
    },
    async (req, reply) => {
      const parsed = loginSchema.safeParse(req.body);
      if (!parsed.success) throw ZodFail(parsed.error);
      const { email, password } = parsed.data;

      const [user] = await db
        .select()
        .from(users)
        .where(eq(sqlLower(users.email), email.toLowerCase()))
        .limit(1);
      if (!user) throw new AppError('unauthorized', 'Email or password is incorrect.');
      if (!user.isActive) throw new AppError('forbidden', 'This account has been deactivated.');

      const ok = await argonVerify(user.passwordHash, password, ARGON_OPTS);
      if (!ok) throw new AppError('unauthorized', 'Email or password is incorrect.');

      // reuse argon default: if hash options differ, upgrade opportunistically
      await createSession(user.id, req, reply);
      return reply.send({ user: publicUser(user), message: 'Signed in.' });
    },
  );

  /* ---------------------------------------------------------------- logout */
  app.post('/logout', { schema: { tags: ['auth'] } }, async (req, reply) => {
    req.csrfValidate();
    const token = req.cookies?.[SESSION_COOKIE];
    await destroySession(token);
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return reply.send({ ok: true });
  });

  /* -------------------------------------------------------------------- me */
  app.get('/me', { schema: { tags: ['auth'] } }, async (req) => {
    const user = requireAuth(req);
    let customer = null;
    if (user.role === 'customer') {
      const rows = await db.select().from(customers).where(eq(customers.userId, user.id)).limit(1);
      customer = rows[0] ?? null;
    }
    return { user, customer, csrf: req.cookies?.['bl_csrf'] ?? null };
  });

  /* ------------------------------------------------------------ get csrf */
  app.get('/csrf', { schema: { tags: ['auth'] } }, async (req, reply) => {
    return reply.send({ csrf: req.cookies?.['bl_csrf'] ?? null });
  });

  /* --------------------------------------------------------------- forgot */
  app.post(
    '/forgot',
    {
      config: { rateLimit: { max: 5, timeWindow: '10 minutes' } },
      schema: { tags: ['auth'] },
    },
    async (req, reply) => {
      const parsed = forgotSchema.safeParse(req.body);
      if (!parsed.success) throw ZodFail(parsed.error);

      const [user] = await db
        .select()
        .from(users)
        .where(eq(sqlLower(users.email), parsed.data.email.toLowerCase()))
        .limit(1);
      if (user) {
        await sendTokenEmail(user.id, user.email, 'reset_password');
      }
      // Do not reveal whether the account exists (user enumeration defence)
      return reply.send({
        message: 'If an account exists for that email, a reset link has been sent.',
      });
    },
  );

  /* ---------------------------------------------------------------- reset */
  app.post(
    '/reset',
    {
      config: { rateLimit: { max: 10, timeWindow: '10 minutes' } },
      schema: { tags: ['auth'] },
    },
    async (req, reply) => {
      const parsed = resetSchema.safeParse(req.body);
      if (!parsed.success) throw ZodFail(parsed.error);
      const { token, password } = parsed.data;

      const rows = await db
        .select({ id: emailTokens.id, userId: emailTokens.userId, expiresAt: emailTokens.expiresAt })
        .from(emailTokens)
        .where(
          and(
            eq(emailTokens.tokenHash, hashToken(token)),
            eq(emailTokens.purpose, 'reset_password'),
            isNull(emailTokens.usedAt),
            gt(emailTokens.expiresAt, new Date()),
          ),
        )
        .limit(1);
      const entry = rows[0];
      if (!entry) throw badRequest('This reset link is invalid or has expired. Please request a new one.');

      const passwordHash = await argonHash(password, ARGON_OPTS);
      await db.transaction(async (tx) => {
        await tx.update(users).set({ passwordHash, updatedAt: new Date() }).where(eq(users.id, entry.userId));
        // single-use: burn ALL open reset tokens for the user, not just this one
        await tx
          .update(emailTokens)
          .set({ usedAt: new Date() })
          .where(and(eq(emailTokens.userId, entry.userId), eq(emailTokens.purpose, 'reset_password'), isNull(emailTokens.usedAt)));
      });

      await sendMessage((await db.select({ email: users.email }).from(users).where(eq(users.id, entry.userId)).limit(1))[0]?.email ?? '', 'Your Brightloop password was changed', 'Your password was just changed. If this wasn\'t you, contact support immediately.');
      return reply.send({ message: 'Password updated. You can sign in now.' });
    },
  );

  /* --------------------------------------------------------------- verify */
  app.post('/verify', { schema: { tags: ['auth'] } }, async (req) => {
    const parsed = verifySchema.safeParse(req.body);
    if (!parsed.success) throw ZodFail(parsed.error);
    const rows = await db
      .select({ userId: emailTokens.userId })
      .from(emailTokens)
      .where(
        and(
          eq(emailTokens.tokenHash, hashToken(parsed.data.token)),
          eq(emailTokens.purpose, 'verify_email'),
          isNull(emailTokens.usedAt),
          gt(emailTokens.expiresAt, new Date()),
        ),
      )
      .limit(1);
    if (!rows[0]) throw badRequest('This verification link is invalid or has expired.');
    await db.transaction(async (tx) => {
      await tx.update(users).set({ emailVerified: true }).where(eq(users.id, rows[0]!.userId));
      await tx
        .update(emailTokens)
        .set({ usedAt: new Date() })
        .where(and(eq(emailTokens.userId, rows[0]!.userId), eq(emailTokens.purpose, 'verify_email')));
    });
    return { message: 'Email verified. Welcome to Brightloop!' };
  });

  /* ----------------------------------------------------------------- demo */
  // quick check of email/password availability for live inline validation on the signup form
  app.get('/email-available', { schema: { tags: ['auth'] } }, async (req) => {
    const q = req.query as { email?: string };
    const parsed = emailSchema.safeParse(q.email ?? '');
    if (!parsed.success) return { available: false };
    const rows = await db.select({ id: users.id }).from(users).where(eq(sqlLower(users.email), parsed.data)).limit(1);
    return { available: rows.length === 0 };
  });
}

/* ------------------------------------------------------------ helpers */

function publicUser(u: typeof users.$inferSelect) {
  return { id: u.id, email: u.email, name: u.name, role: u.role, emailVerified: u.emailVerified };
}

const registerSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  name: nameSchema,
  companyName: z.string().trim().min(2, 'Company name must be at least 2 characters.').max(200),
  phone: z.string().trim().max(32).optional(),
  address: z.string().trim().max(500).optional(),
});

const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Password is required.'),
});

const forgotSchema = z.object({ email: emailSchema });
const resetSchema = z.object({ token: z.string().min(10), password: passwordSchema });
const verifySchema = z.object({ token: z.string().min(10) });

/** Maps a ZodError onto the AppError envelope with per-field details */
function ZodFail(error: z.ZodError): AppError {
  return new AppError('validation_error', error.issues[0]?.message ?? 'Invalid input.', {
    details: error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
  });
}

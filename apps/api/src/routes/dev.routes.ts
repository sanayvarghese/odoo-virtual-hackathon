import type { FastifyInstance } from 'fastify';
import { db } from '../db/client.js';
import { users } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { requireRole } from '../plugins/auth.js';
import { listMailbox } from '../lib/mailbox.js';
import { mailEnabled } from '../lib/mailer.js';
import { env } from '../env.js';

/**
 * DEV utilities. Guarded behind NODE_ENV !== 'production' at runtime AND
 * admin role, since the mailbox leaks token *user ids* (never the raw tokens).
 */
export default async function devRoutes(app: FastifyInstance) {
  app.get('/mailbox', { schema: { tags: ['dev'] } }, async (req) => {
    req.csrfValidate(); // GET: no-op; kept for uniformity of the security check surface
    const items = await listMailbox(50);
    // join to show recipient email
    const withEmail = await Promise.all(
      items.map(async (item) => {
        const [u] = await db.select({ email: users.email }).from(users).where(eq(users.id, item.userId)).limit(1);
        return { ...item, email: u?.email ?? `user#${item.userId}` };
      }),
    );
    return { items: withEmail, note: 'Dev-only mailbox. In production these would be sent by SMTP.' };
  });

  app.get('/config', { schema: { tags: ['dev'] } }, async () => ({
    apiUrl: `http://localhost:${env.PORT}`,
    appUrl: env.APP_URL,
    aiModel: env.OLLAMA_MODEL,
    aiUrl: env.OLLAMA_URL,
    mailMode: mailEnabled() ? 'smtp' : 'mailbox',
  }));

  app.post('/gate', { schema: { hide: true }, preHandler: requireRole('admin') }, async (req) => {
    req.csrfValidate();
    if (!req.user) throw new Error('unreachable: requireRole guarantees user');
    return { ok: true, user: req.user.email };
  });
}

import type { FastifyInstance } from 'fastify';
import { eq, count, ilike, or } from 'drizzle-orm';
import { z } from 'zod';
import { hash } from '@node-rs/argon2';

import { db } from '../db/client.js';
import { auditLog, users } from '../db/schema.js';
import { requireAuth, requireRole } from '../plugins/auth.js';
import { AppError, idParamSchema, pageSchema, parseOrThrow } from '../lib/route-helpers.js';
import { emailSchema, nameSchema } from '../lib/validators.js';
import { sendMessage } from '../lib/mailbox.js';
import { env } from '../env.js';

/**
 * Scene: "Only the admin can add a new member of staff."
 * Also enforces that staff can never be promoted/demoted here in bulk — one endpoint,
 * audited, admin-only.
 */
const ARGON_OPTS = { memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;

const createStaffSchema = z.object({
  email: emailSchema,
  name: nameSchema,
});

export default async function staffRoutes(app: FastifyInstance) {
  app.get('/', { schema: { tags: ['staff'] }, preHandler: requireRole('admin') }, async (req) => {
    const { q, page, limit } = pageSchema.parse(req.query ?? {});
    const where = q ? or(ilike(users.name, `%${q}%`), ilike(users.email, `%${q}%`)) : undefined;
    const [rows, total] = await Promise.all([
      db
        .select({ id: users.id, email: users.email, name: users.name, role: users.role, isActive: users.isActive, createdAt: users.createdAt })
        .from(users)
        .where(q ? (where ?? eq(users.role, 'staff')) : undefined)
        .limit(limit)
        .offset((page - 1) * limit),
      db.select({ total: count() }).from(users).where(q ? (where ?? eq(users.role, 'staff')) : undefined),
    ]);
    return { items: rows, page, limit, total: total[0]?.total ?? 0 };
  });

  app.post('/', { schema: { tags: ['staff'] }, preHandler: requireRole('admin') }, async (req, reply) => {
    req.csrfValidate();
    const admin = requireAuth(req);
    const data = parseOrThrow(createStaffSchema, req.body);
    const exists = await db.select({ id: users.id }).from(users).where(eq(users.email, data.email)).limit(1);
    if (exists.length > 0) throw new AppError('conflict', 'A user with this email already exists.');

    const [staff] = await db
      .insert(users)
      .values({
        email: data.email,
        name: data.name,
        passwordHash: await hash('Brightloop@Temp1', ARGON_OPTS),
        role: 'staff',
        emailVerified: true, // admin-created, no verification loop required (documented)
      })
      .returning();

    await db.insert(auditLog).values({
      actorId: admin.id,
      action: 'staff.created',
      entity: 'user',
      entityId: staff!.id,
      summary: `Admin ${admin.email} added staff member ${staff!.email}`,
    });

    await sendMessage(
      staff!.email,
      'Welcome to the Brightloop team',
      `Hi ${staff!.name},\n\nAn account (role: staff) has been created for you.\nTemporary password: Brightloop@Temp1 — change it after first login.\n\nURL: ${env.APP_URL}`,
    );
    return reply.status(201).send({ staff: { id: staff!.id, email: staff!.email, name: staff!.name, role: staff!.role } });
  });

  app.post('/:id/deactivate', { schema: { tags: ['staff'] }, preHandler: requireRole('admin') }, async (req) => {    req.csrfValidate();
    const { id } = idParamSchema.parse(req.params);
    const admin = requireAuth(req);
    const rows = await db.select().from(users).where(eq(users.id, id)).limit(1);
    if (!rows[0]) throw new AppError('not_found', 'Staff member not found.');
    if (rows[0].role !== 'staff') throw new AppError('conflict', 'Only staff accounts can be deactivated here.');
    if (rows[0].id === admin.id) throw new AppError('conflict', 'You cannot deactivate your own account.');
    await db.update(users).set({ isActive: false }).where(eq(users.id, id));
    await db.insert(auditLog).values({
      actorId: admin.id,
      action: 'staff.deactivated',
      entity: 'user',
      entityId: id,
      summary: `Deactivated staff ${rows[0].email}`,
    });
    return { ok: true };
  });

  /* --------------------------------------------------------- promote to staff */
  // Scene: "the admin can promote a user to staff." Only customer accounts can
  // be promoted; admins cannot be created or overwritten from here.
  app.post('/:id/promote', { schema: { tags: ['staff'] }, preHandler: requireRole('admin') }, async (req) => {
    req.csrfValidate();
    const admin = requireAuth(req);
    const { id } = idParamSchema.parse(req.params);
    const rows = await db.select().from(users).where(eq(users.id, id)).limit(1);
    if (!rows[0]) throw new AppError('not_found', 'User not found.');
    if (rows[0].role !== 'customer') {
      throw new AppError('conflict', 'Only customer accounts can be promoted to staff.');
    }
    await db.update(users).set({ role: 'staff', updatedAt: new Date() }).where(eq(users.id, id));
    await db.insert(auditLog).values({
      actorId: admin.id,
      action: 'staff.promoted',
      entity: 'user',
      entityId: id,
      summary: `Promoted ${rows[0].email} from customer to staff`,
    });
    return { ok: true, user: { id, email: rows[0].email, name: rows[0].name, role: 'staff' } };
  });
}

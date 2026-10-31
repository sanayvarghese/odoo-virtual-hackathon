import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { z } from 'zod';

import { db } from '../db/client.js';
import { aiImportJobs } from '../db/schema.js';
import { requireAuth, requireRole, requireAuthHook } from '../plugins/auth.js';
import { AppError, parseOrThrow } from '../lib/route-helpers.js';
import { ollamaHealth } from '../lib/ollama.js';
import { streamCopilot } from '../services/ai/agent.service.js';
import {
  ENTITY_SPECS,
  commitImport,
  heuristicMap,
  llmRepairMap,
  llmSoftRepair,
  mapRows,
  parseText,
  parseWorkbook,
  stageImport,
  type ImportEntity,
} from '../services/ai/import.service.js';

const chatSchema = z.object({
  messages: z
    .array(
      z.object({
        role: z.enum(['user', 'assistant']),
        content: z.string().min(1).max(8000),
      }),
    )
    .min(1, 'Send at least one message.')
    .max(30),
});

const MAX_IMPORT_ROWS = 5000;

export default async function aiRoutes(app: FastifyInstance) {
  /* ------------------------------------------------------------- health */
  app.get('/health', { schema: { tags: ['ai'] } }, async () => {
    return ollamaHealth();
  });

  /* ------------------------------------------------- copilot chat (SSE) */
  app.post('/chat', { schema: { tags: ['ai'] }, preHandler: requireAuthHook }, async (req, reply) => {
    req.csrfValidate();
    const user = requireAuth(req);
    const { messages } = parseOrThrow(chatSchema, req.body ?? {});
    await streamCopilot(reply, user, messages);
    return reply; // response already handled via raw stream
  });

  /* ------------------------------------------------ bulk import: upload */
  app.post(
    '/import',
    { schema: { tags: ['ai'] }, preHandler: requireAuthHook },
    async (req, reply) => {
      req.csrfValidate();
      const user = requireAuth(req);
      if (user.role === 'customer') {
        throw new AppError('forbidden', 'Bulk imports are for staff and admins.');
      }

      const entityRaw = (req.query as Record<string, string | undefined>).entity ?? 'product';
      const entity = (['product', 'plan', 'customer'].includes(entityRaw) ? entityRaw : 'product') as ImportEntity;

      // supports multipart file upload OR JSON {text}
      const contentType = req.headers['content-type'] ?? '';
      let filename = 'pasted-text';
      let parsed;
      if (contentType.includes('multipart/form-data')) {
        const file = await (req.body as { file?: { toBuffer: () => Promise<Buffer>; filename: string } }).file;
        if (!file || typeof file.toBuffer !== 'function') {
          throw new AppError('validation_error', 'Attach a .xlsx, .csv or paste text in the field `text`.');
        }
        const buffer = await file.toBuffer();
        filename = file.filename ?? 'upload.xlsx';
        parsed = parseWorkbook(buffer, filename);
      } else {
        const body = req.body as { text?: string } | undefined;
        if (!body?.text || body.text.trim().length < 5) {
          throw new AppError('validation_error', 'Provide a file upload or non-empty `text`.');
        }
        if (body.text.length > 500_000) {
          throw new AppError('validation_error', 'Text is too large (500KB max).');
        }
        parsed = parseText(body.text);
      }

      if (parsed.rows.length === 0) throw new AppError('validation_error', 'The file has no data rows.');
      if (parsed.rows.length > MAX_IMPORT_ROWS) {
        throw new AppError('validation_error', `Too many rows (${parsed.rows.length}); the limit is ${MAX_IMPORT_ROWS}.`);
      }

      // 1) deterministic header mapping; 2) model only when heuristics stall
      let map = heuristicMap(entity, parsed.headers);
      const requiredFields = ENTITY_SPECS[entity].filter((f) => f.required).map((f) => f.field);
      const missingRequired = requiredFields.filter((f) => !map[f]);
      if (missingRequired.length > 0) {
        const llmMap = await llmRepairMap(entity, parsed.headers, parsed.rows.slice(0, 5)).catch(() => ({}));
        map = { ...llmMap, ...map }; // heuristics win where they agree
      }
      if (requiredFields.some((f) => !map[f])) {
        const fields = requiredFields.join(', ');
        throw new AppError(
          'validation_error',
          `Could not map required columns (${fields}). Rename the columns, or paste a header row like: ${ENTITY_SPECS[entity].map((f) => f.aliases[0]).join(', ')}`,
        );
      }

      // 3) map + validate all rows locally
      let mapped = mapRows(entity, parsed.headers, parsed.rows, map);
      const bad = mapped.filter((r) => !r.ok);
      const validBefore = mapped.length - bad.length;

      // 4) soft-repair through the model ONLY for failing rows (small batches)
      if (bad.length > 0 && bad.length <= 60) {
        const repaired = await llmSoftRepair(entity, bad);
        mapped = mapped.filter((r) => r.ok).concat(repaired).sort((a, b) => a.row - b.row);
      }

      // 5) stage + preview
      const job = await stageImport(user.id, filename, entity, parsed.headers, parsed.rows, map, mapped);
      return reply.status(201).send({
        jobId: job.id,
        entity,
        mapping: map,
        columns: Object.fromEntries(ENTITY_SPECS[entity].filter((f) => f.field in map).map((f) => [f.field, map[f.field] ?? null])),
        totalRows: parsed.rows.length,
        validCount: mapped.filter((r) => r.ok).length,
        invalidCount: mapped.filter((r) => !r.ok).length,
        validBeforeFix: validBefore,
        rows: mapped.map((r) => ({ row: r.row, ok: r.ok, errors: r.errors, data: r.data })),
      });
    },
  );

  /* ------------------------------------------------ bulk import: commit */
  app.post(
    '/import/:jobId/commit',
    { schema: { tags: ['ai'] }, preHandler: requireRole('admin', 'staff') },
    async (req, reply) => {
      req.csrfValidate();
      const user = requireAuth(req);
      const { jobId } = parseOrThrow(z.object({ jobId: z.string().uuid() }), req.params);
      const { force } = parseOrThrow(
        z.object({ force: z.boolean().default(false) }),
        req.body ?? {},
      );
      if (!force) {
        // data safety: require explicit confirmation of partial imports
        const [job] = await db.select().from(aiImportJobs).where(eq(aiImportJobs.id, jobId)).limit(1);
        if (!job) throw new AppError('not_found', 'Import job not found.');
        if ((job.invalidCount ?? 0) > 0 && !force) {
          throw new AppError(
            'conflict',
            `${job.invalidCount} rows are invalid. Fix them, re-upload, or send { "force": true } to import only the valid rows.`,
          );
        }
      }
      const res = await commitImport(jobId, user.id);
      return reply.send(res);
    },
  );

  app.get('/import/:jobId', { schema: { tags: ['ai'] }, preHandler: requireAuthHook }, async (req) => {
    const user = requireAuth(req);
    const { jobId } = parseOrThrow(z.object({ jobId: z.string().uuid() }), req.params);
    const [job] = await db.select().from(aiImportJobs).where(eq(aiImportJobs.id, jobId)).limit(1);
    if (!job) throw new AppError('not_found', 'Import job not found.');
    if (user.role === 'customer') throw new AppError('forbidden', 'Import jobs are for staff and admins.');
    return { job };
  });
}

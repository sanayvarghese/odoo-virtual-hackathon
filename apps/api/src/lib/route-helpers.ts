import { z } from 'zod';
import { AppError } from './errors.js';

export { AppError };

/** Maps a ZodError onto the AppError envelope with per-field details */
export function ZodFail(error: z.ZodError): AppError {
  return new AppError('validation_error', error.issues[0]?.message ?? 'Invalid input.');
}

export function ZodFailDetails(error: z.ZodError) {
  return error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
}

/** Validates `data` and throws a friendly AppError on failure — the one used everywhere */
export function parseOrThrow<S extends z.ZodType>(schema: S, data: unknown): z.infer<S> {
  const res = schema.safeParse(data);
  if (!res.success) {
    throw new AppError('validation_error', firstMessage(res.error), {
      details: res.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    });
  }
  return res.data;
}

function firstMessage(error: z.ZodError): string {
  return error.issues[0]?.message ?? 'Invalid input.';
}

export const idParamSchema = z.object({ id: z.coerce.number().int().positive() });

export const pageSchema = z.object({
  q: z.string().trim().max(120).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  sort: z.string().max(40).optional(),
  dir: z.enum(['asc', 'desc']).default('desc'),
});

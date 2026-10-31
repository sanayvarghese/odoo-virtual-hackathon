import { z } from 'zod';

/* ---------------------------------------------------------- shared money */
/** Money is cents; accept int only (frontend converts digits input to cents) */
export const cents = (label: string) =>
  z
    .number({ error: `${label} is required.` })
    .int(`${label} must be a whole number of cents.`)
    .min(0, `${label} cannot be negative.`)
    .max(10 ** 13, `${label} is too large.`);

export const sku = z
  .string()
  .trim()
  .min(2, 'SKU must be at least 2 characters.')
  .max(64)
  .regex(/^[A-Za-z0-9_-]+$/, 'SKU can only contain letters, numbers, dashes and underscores.');

export const pageQuery = z.object({
  q: z.string().trim().max(120).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  sort: z.string().max(40).optional(),
  dir: z.enum(['asc', 'desc']).default('desc'),
});

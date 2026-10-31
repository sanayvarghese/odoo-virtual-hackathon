import { z } from 'zod';

/** Email must be a real, well-formed address */
export const emailSchema = z
  .string({ error: 'Email is required.' })
  .trim()
  .min(1, 'Email is required.')
  .max(255)
  .email('Please enter a valid email address.')
  .transform((v) => v.toLowerCase());

/**
 * Password policy straight from the problem statement:
 * "more than eight characters, with an uppercase letter, a lowercase letter and a special character"
 */
export const passwordSchema = z
  .string({ error: 'Password is required.' })
  .min(9, 'Password must be more than 8 characters long.')
  .max(128, 'Password is too long.')
  .refine((v) => /[a-z]/.test(v), 'Password must contain a lowercase letter.')
  .refine((v) => /[A-Z]/.test(v), 'Password must contain an uppercase letter.')
  .refine((v) => /[^A-Za-z0-9]/.test(v), 'Password must contain a special character.');

export const nameSchema = z
  .string()
  .trim()
  .min(2, 'Name must be at least 2 characters.')
  .max(120, 'Name is too long.');

export const moneyCents = z
  .number({ error: 'Amount is required.' })
  .int('Amount must be an integer amount of cents.')
  .min(0, 'Amount cannot be negative.');

export const quantitySchema = z
  .number()
  .int('Quantity must be a whole number.')
  .min(1, 'Quantity must be at least 1.')
  .max(1_000_000, 'Quantity is too large.');

export const idParam = z.object({ id: z.coerce.number().int().positive() });

export const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format.')
  .refine((v) => !Number.isNaN(new Date(v).getTime()), 'Enter a valid date.');

export const bannerInterval = z.enum(['daily', 'weekly', 'monthly', 'yearly']);

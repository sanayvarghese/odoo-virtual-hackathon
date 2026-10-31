import { z } from 'zod';
import { config } from 'dotenv';

config();

const envSchema = z.object({
  PORT: z.coerce.number().default(4000),
  DATABASE_URL: z
    .string()
    .url()
    .default('postgres://postgres:root@localhost:5432/brightloop'),
  CORS_ORIGIN: z.string().default('http://localhost:3000'),
  APP_URL: z.string().default('http://localhost:3000'),
  SESSION_TTL_DAYS: z.coerce.number().default(30),
  OLLAMA_URL: z.string().default('http://localhost:11434'),
  OLLAMA_MODEL: z.string().default('qwen3.5:9b-q4_K_M'),
  SEED_PASSWORD: z.string().default('Bright@2025'),
  // Real email (optional). When SMTP_HOST is set, verification/reset links go
  // out through Nodemailer SMTP (Brevo free tier, Gmail app password, etc.);
  // otherwise they stay in the dev mailbox. See lib/mailer.ts.
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().default(587),
  SMTP_SECURE: z
    .string()
    .default('false')
    .transform((v) => v === 'true' || v === '465'),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  MAIL_FROM: z.string().default('Brightloop <no-reply@brightloop.dev>'),
});

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  console.error('❌ Invalid environment variables:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;

/** Origgins allowed for CORS (comma separated list in env), as array */
export const corsOrigins = env.CORS_ORIGIN.split(',').map((s) => s.trim());

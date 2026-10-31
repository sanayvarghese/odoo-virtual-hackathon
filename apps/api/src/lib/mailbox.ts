/**
 * Email delivery: real SMTP when configured (see lib/mailer.ts), and ALWAYS a
 * dev-mailbox copy so the demo can read any message at /mailbox. Verification
 * and password-reset links therefore reach a real inbox when SMTP_* env vars
 * are set, without breaking the offline demo.
 */
import { db } from '../db/client.js';
import { emailTokens } from '../db/schema.js';
import { eq, desc } from 'drizzle-orm';
import { env } from '../env.js';
import { mailEnabled, sendRealEmail } from './mailer.js';

export async function sendMessage(
  to: string,
  subject: string,
  body: string,
): Promise<void> {
  if (mailEnabled()) {
    await sendRealEmail(to, subject, body);
    console.log(`📧 [dev mailbox copy] ${subject} → also recorded at /mailbox`);
    return;
  }
  console.log('\n📧 [dev mailbox] ----------------------------');
  console.log(`To     : ${to}`);
  console.log(`Subject: ${subject}`);
  console.log(body);
  console.log('---------------------------------------------\n');
}

/** Generates a secure single-purpose token, stores only its hash, and "emails" the link. */
export async function sendTokenEmail(
  userId: number,
  to: string,
  purpose: 'verify_email' | 'reset_password',
): Promise<string> {
  const token = await import('node:crypto').then((c) => c.randomBytes(32).toString('base64url'));
  const { createHash } = await import('node:crypto');
  const hash = createHash('sha256').update(token).digest('hex');
  const expiresAt = new Date(Date.now() + 30 * 60 * 1000); // 30 minutes
  await db.insert(emailTokens).values({ userId, purpose, tokenHash: hash, expiresAt });
  const path = purpose === 'reset_password' ? 'reset-password' : 'verify';
  const link = `${env.APP_URL}/${path}?token=${token}`;
  await sendMessage(
    to,
    purpose === 'reset_password' ? 'Reset your Brightloop password' : 'Verify your Brightloop email',
    `Hello,\n\nUse this link (valid for 30 minutes):\n\n${link}\n\nIf you didn't request this, ignore this email.\n— Brightloop`,
  );
  return token;
}

export async function listMailbox(limit = 20) {
  return db
    .select({
      id: emailTokens.id,
      userId: emailTokens.userId,
      purpose: emailTokens.purpose,
      expiresAt: emailTokens.expiresAt,
      usedAt: emailTokens.usedAt,
      createdAt: emailTokens.createdAt,
    })
    .from(emailTokens)
    .orderBy(desc(emailTokens.createdAt))
    .limit(limit);
}

export { eq };

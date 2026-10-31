/**
 * Real email over SMTP, the open-source way: Nodemailer with any provider that
 * speaks SMTP — Brevo's free relay (300/day), Gmail with an app password,
 * Amazon SES, Mailgun, a self-hosted relay. Enabled purely by environment
 * variables; without them the app falls back to the dev mailbox, so the demo
 * never needs credentials.
 *
 *   SMTP_HOST=smtp-relay.brevo.com   (or smtp.gmail.com)
 *   SMTP_PORT=587                    (465 → implicit TLS)
 *   SMTP_USER=you@yourdomain.com
 *   SMTP_PASS=your smtp key / app password
 *   MAIL_FROM="Brightloop <no-reply@yourdomain.com>"
 */
import { env } from '../env.js';

export function mailEnabled(): boolean {
  return Boolean(env.SMTP_HOST && env.SMTP_USER && env.SMTP_PASS);
}

/** Sends one email; resolves to true when the provider accepted it, false on refusal. */
export async function sendRealEmail(to: string, subject: string, body: string): Promise<boolean> {
  if (!mailEnabled()) return false;
  try {
    const { createTransport } = await import('nodemailer');
    const transport = createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_SECURE,
      auth: { user: env.SMTP_USER, pass: env.SMTP_PASS },
    });
    await transport.sendMail({ from: env.MAIL_FROM, to, subject, text: body });
    console.log(`📧 [smtp] sent to ${maskEmail(to)} — "${subject}"`);
    return true;
  } catch (e) {
    // SMTP reports refusals and network failures the same way; log masked and carry on.
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`📧 [smtp] delivery failed (${maskEmail(msg)}) — the dev mailbox still holds the message.`);
    return false;
  }
}

function maskEmail(s: string): string {
  return s.replace(/[^\s<>@]+@[^\s<>]+/g, (m) => {
    const [user, domain] = m.split('@');
    return `${user!.slice(0, 2)}***@${domain}`;
  });
}

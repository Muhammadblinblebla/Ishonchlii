/**
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║  EMAIL YUBORISH                                                          ║
 * ║                                                                          ║
 * ║  Ikki drayver:                                                           ║
 * ║   • `log`  — xabarni konsolga chiqaradi. Standart. Hech qanday sozlama   ║
 * ║              talab qilmaydi, ishlab chiqishda darhol ishlaydi.           ║
 * ║   • `smtp` — haqiqiy yuborish. Har qanday SMTP xizmati bilan ishlaydi    ║
 * ║              (Gmail, Yandex, Mailgun, Resend, …).                        ║
 * ║                                                                          ║
 * ║  Drayver `EMAIL_DRIVER` orqali tanlanadi.                                ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 */

import { createTransport, type Transporter } from 'nodemailer';
import { env } from '../config/env.js';

export interface EmailMessage {
  readonly to: string;
  readonly subject: string;
  readonly heading: string;
  readonly body: string;
  readonly actionLabel: string | null;
  readonly actionUrl: string | null;
}

export type SendResult =
  | { readonly ok: true }
  /** `retryable: false` — qayta urinish foydasiz (masalan manzil noto'g'ri). */
  | { readonly ok: false; readonly error: string; readonly retryable: boolean };

export interface EmailDriver {
  readonly name: string;
  send(message: EmailMessage): Promise<SendResult>;
}

// ─── HTML shabloni ───────────────────────────────────────────────────────────

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Oddiy, ishonchli HTML.
 *
 * Email mijozlari (Gmail, Outlook) zamonaviy CSS'ni qo'llab-quvvatlamaydi,
 * shuning uchun jadval va inline uslublar ishlatilgan — bu email uchun
 * standart yondashuv.
 */
export function renderHtml(message: EmailMessage): string {
  const paragraphs = message.body
    .split('\n\n')
    .map((p) => `<p style="margin:0 0 16px;line-height:1.6;color:#334155">${escapeHtml(p).replace(/\n/g, '<br>')}</p>`)
    .join('');

  const button =
    message.actionLabel && message.actionUrl
      ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0">
           <tr><td style="border-radius:8px;background:#1a5cf5">
             <a href="${escapeHtml(message.actionUrl)}"
                style="display:inline-block;padding:12px 24px;font-family:sans-serif;
                       font-size:14px;font-weight:500;color:#ffffff;text-decoration:none">
               ${escapeHtml(message.actionLabel)}
             </a>
           </td></tr>
         </table>`
      : '';

  return `<!doctype html>
<html lang="uz"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:24px;background:#f8fafc;font-family:-apple-system,Segoe UI,Roboto,sans-serif">
  <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width:560px;margin:0 auto">
    <tr><td style="padding:0 0 16px">
      <span style="font-size:18px;font-weight:600;color:#0f172a">Escrow.uz</span>
    </td></tr>
    <tr><td style="background:#ffffff;border:1px solid #e2e8f0;border-radius:12px;padding:32px">
      <h1 style="margin:0 0 16px;font-size:20px;color:#0f172a">${escapeHtml(message.heading)}</h1>
      ${paragraphs}
      ${button}
    </td></tr>
    <tr><td style="padding:16px 0;font-size:12px;color:#94a3b8;text-align:center">
      Escrow.uz — pul faqat tovar yetib borgach o'tadi
    </td></tr>
  </table>
</body></html>`;
}

/** Matn varianti — HTML ko'rsatmaydigan mijozlar uchun. */
export function renderText(message: EmailMessage): string {
  const action =
    message.actionLabel && message.actionUrl
      ? `\n\n${message.actionLabel}: ${message.actionUrl}`
      : '';
  return `${message.heading}\n\n${message.body}${action}\n\n—\nEscrow.uz`;
}

// ─── Drayverlar ──────────────────────────────────────────────────────────────

/**
 * Konsolga chiqaradi. Standart drayver.
 *
 * Ishlab chiqishda haqiqiy email yubormaydi — bu ataylab: test paytida
 * tasodifan haqiqiy odamlarga xat ketib qolmasligi uchun.
 */
class LogDriver implements EmailDriver {
  readonly name = 'log';

  send(message: EmailMessage): Promise<SendResult> {
    console.log(
      `\n┌─ EMAIL (yuborilmadi, faqat ko'rsatildi) ────────────────────\n` +
        `│ Kimga : ${message.to}\n` +
        `│ Mavzu : ${message.subject}\n` +
        `├─────────────────────────────────────────────────────────────\n` +
        message.body
          .split('\n')
          .map((l) => `│ ${l}`)
          .join('\n') +
        (message.actionUrl ? `\n│\n│ → ${message.actionLabel}: ${message.actionUrl}` : '') +
        `\n└─────────────────────────────────────────────────────────────\n`,
    );
    return Promise.resolve({ ok: true });
  }
}

class SmtpDriver implements EmailDriver {
  readonly name = 'smtp';
  private transporter: Transporter | null = null;

  private getTransporter(): Transporter {
    this.transporter ??= createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      // 465 — implicit TLS, boshqa portlarda STARTTLS
      secure: env.SMTP_PORT === 465,
      auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASSWORD } : undefined,
    });
    return this.transporter;
  }

  async send(message: EmailMessage): Promise<SendResult> {
    try {
      await this.getTransporter().sendMail({
        from: env.EMAIL_FROM,
        to: message.to,
        subject: message.subject,
        text: renderText(message),
        html: renderHtml(message),
      });
      return { ok: true };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);

      // 5xx — doimiy xato (manzil yo'q, bloklangan). Qayta urinish foydasiz.
      // 4xx yoki tarmoq xatosi — vaqtinchalik, qayta urinamiz.
      const permanent = /\b5\d\d\b/.test(error) || /no such user|mailbox unavailable/i.test(error);

      return { ok: false, error, retryable: !permanent };
    }
  }
}

let driver: EmailDriver | null = null;

export function getEmailDriver(): EmailDriver {
  if (driver) return driver;
  driver = env.EMAIL_DRIVER === 'smtp' ? new SmtpDriver() : new LogDriver();
  return driver;
}

/** Testlar uchun. */
export function setEmailDriver(custom: EmailDriver | null): void {
  driver = custom;
}

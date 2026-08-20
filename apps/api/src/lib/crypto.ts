/**
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║  MAXFIY MA'LUMOTLARNI SHIFRLASH                                          ║
 * ║                                                                          ║
 * ║  O'yin akkauntining login va paroli bazaga OCHIQ yozilmaydi.            ║
 * ║                                                                          ║
 * ║  Nega: baza nusxasi (backup, Supabase paneli, sizib chiqqan dump)        ║
 * ║  minglab odamning o'yin parollarini oshkor qilardi. Ko'p odam bir xil    ║
 * ║  parolni bir necha joyda ishlatadi — zarar bitta platforma bilan          ║
 * ║  cheklanmasdi.                                                           ║
 * ║                                                                          ║
 * ║  Algoritm: AES-256-GCM.                                                  ║
 * ║   • GCM shifrlash BILAN BIRGA butunlikni ham tekshiradi (authTag).       ║
 * ║     Ya'ni kimdir bazadagi shifrmatnni o'zgartirsa, ochish paytida        ║
 * ║     xato beradi — jimgina buzilgan ma'lumot chiqmaydi.                   ║
 * ║   • Har shifrlashda YANGI tasodifiy IV. Bir xil parol ikki savdoda       ║
 * ║     boshqacha ko'rinadi.                                                 ║
 * ║                                                                          ║
 * ║  Kalit `CREDENTIALS_SECRET` muhit o'zgaruvchisidan olinadi — bazada      ║
 * ║  EMAS. Baza va kalit bir joyda saqlansa shifrlashdan foyda yo'q.         ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 */

import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { env } from '../config/env.js';

const ALGORITHM = 'aes-256-gcm';
/** GCM uchun tavsiya etilgan IV uzunligi. */
const IV_BYTES = 12;
const TAG_BYTES = 16;
/** Format o'zgarsa shu raqam oshadi va eski yozuvlar ham o'qilaveradi. */
const VERSION = 'v1';

/**
 * 32 baytlik kalit.
 *
 * `CREDENTIALS_SECRET` ixtiyoriy uzunlikdagi satr bo'lishi mumkin, shuning
 * uchun SHA-256 dan o'tkaziladi — natija doim aynan 32 bayt.
 *
 * Kalit MODUL YUKLANGANDA emas, birinchi ishlatilganda hisoblanadi: shifrlash
 * umuman kerak bo'lmaydigan ishga tushishlarda (masalan faqat migratsiya)
 * sozlama yo'qligi to'sqinlik qilmasin.
 */
let cachedKey: Buffer | null = null;

function key(): Buffer {
  if (cachedKey) return cachedKey;

  const secret = env.CREDENTIALS_SECRET;
  if (!secret || secret.trim().length < 32) {
    throw new Error(
      'CREDENTIALS_SECRET sozlanmagan (kamida 32 belgi). ' +
        'Usiz o\'yin akkaunti ma\'lumotlarini shifrlab bo\'lmaydi.',
    );
  }

  cachedKey = createHash('sha256').update(secret, 'utf8').digest();
  return cachedKey;
}

/** Sozlama to'g'rimi — ishga tushishda tekshirish uchun. */
export function credentialsEncryptionReady(): boolean {
  try {
    const probe = 'sozlama-tekshiruvi';
    return decryptSecret(encryptSecret(probe)) === probe;
  } catch {
    return false;
  }
}

/**
 * Matnni shifrlaydi.
 *
 * Natija: `v1.<iv>.<tag>.<ciphertext>` — hammasi base64. Bitta satr bo'lgani
 * uchun bazada bitta ustunda saqlanadi va nusxa ko'chirishda buzilmaydi.
 */
export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key(), iv);

  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [VERSION, iv.toString('base64'), tag.toString('base64'), encrypted.toString('base64')].join(
    '.',
  );
}

/**
 * Shifrni ochadi.
 *
 * Ma'lumot o'zgartirilgan yoki kalit boshqa bo'lsa — `throw`. Jimgina
 * bo'sh yoki buzilgan qiymat QAYTARMAYDI: xaridorga "parol: ????" ko'rsatishdan
 * ko'ra xato ko'rsatib, nizo ochish imkonini berish to'g'riroq.
 */
export function decryptSecret(payload: string): string {
  const parts = payload.split('.');
  if (parts.length !== 4) {
    throw new Error('Shifrlangan ma\'lumot formati noto\'g\'ri');
  }

  const [version, ivB64, tagB64, dataB64] = parts as [string, string, string, string];
  if (version !== VERSION) {
    throw new Error(`Noma'lum shifrlash versiyasi: ${version}`);
  }

  const iv = Buffer.from(ivB64, 'base64');
  const tag = Buffer.from(tagB64, 'base64');
  if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) {
    throw new Error('Shifrlangan ma\'lumot buzilgan');
  }

  const decipher = createDecipheriv(ALGORITHM, key(), iv);
  decipher.setAuthTag(tag);

  // `final()` authTag mos kelmasa xato beradi — butunlik tekshiruvi shu yerda.
  return Buffer.concat([
    decipher.update(Buffer.from(dataB64, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}

// ─────────────────────────────────────────────────────────────────────────────
// AKKAUNT MA'LUMOTLARI
// ─────────────────────────────────────────────────────────────────────────────

export interface AccountCredentials {
  readonly login: string;
  readonly password: string;
  /** Tiklash kodi, bog'langan pochta paroli va h.k. Bo'sh bo'lishi mumkin. */
  readonly extra: string;
}

export function encryptCredentials(credentials: AccountCredentials): string {
  return encryptSecret(JSON.stringify(credentials));
}

export function decryptCredentials(cipher: string): AccountCredentials {
  const parsed: unknown = JSON.parse(decryptSecret(cipher));

  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    typeof (parsed as AccountCredentials).login !== 'string' ||
    typeof (parsed as AccountCredentials).password !== 'string'
  ) {
    throw new Error('Shifrdan chiqqan ma\'lumot kutilgan shaklda emas');
  }

  const value = parsed as AccountCredentials;
  return { login: value.login, password: value.password, extra: value.extra ?? '' };
}

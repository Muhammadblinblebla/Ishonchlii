/**
 * Rasmni BRAUZERDA siqish.
 *
 * Nega server tomonda emas: telefon skrinshoti 3–8 MB bo'ladi. Uni
 * xom holda yuborish sekin mobil internetda bir necha daqiqa ketadi
 * va foydalanuvchi kutib o'tirmaydi. Siqilgandan keyin ~200–400 KB.
 *
 * Server bunga ISHONMAYDI — hajm va turni qayta tekshiradi.
 */

import {
  SUPPORT_ALLOWED_IMAGE_MIMES,
  SUPPORT_IMAGE_MAX_DIMENSION,
  SUPPORT_IMAGE_QUALITY,
  SUPPORT_MAX_IMAGE_BYTES,
} from '@escrowuz/shared';

export interface PreparedImage {
  readonly dataUrl: string;
  readonly fileName: string;
  readonly sizeBytes: number;
  /** Ko'rsatish uchun — siqishdan oldingi hajm. */
  readonly originalBytes: number;
}

export class ImageError extends Error {}

/** `data:` URL ning haqiqiy bayt hajmi (base64 ~33% qo'shadi). */
function dataUrlBytes(dataUrl: string): number {
  const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
  return Math.floor((base64.length * 3) / 4) - padding;
}

export async function prepareImage(file: File): Promise<PreparedImage> {
  if (!file.type.startsWith('image/')) {
    throw new ImageError('Faqat rasm yuklash mumkin');
  }

  const bitmap = await createImageBitmap(file).catch(() => {
    throw new ImageError('Rasmni o\'qib bo\'lmadi. Boshqa fayl tanlang.');
  });

  // Nisbatni saqlab kichiklashtiramiz. Kichik rasm kattalashtirilmaydi —
  // bu sifatni oshirmaydi, faqat hajmni bekorga oshiradi.
  const scale = Math.min(
    1,
    SUPPORT_IMAGE_MAX_DIMENSION / Math.max(bitmap.width, bitmap.height),
  );
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext('2d');
  if (!ctx) throw new ImageError('Brauzer rasmni qayta ishlay olmadi');

  // PNG shaffofligi JPEG'da qora bo'lib chiqadi — oq fon to'ldiramiz
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  let quality = SUPPORT_IMAGE_QUALITY;
  let dataUrl = canvas.toDataURL('image/jpeg', quality);

  // Hali ham katta bo'lsa sifatni bosqichma-bosqich tushiramiz.
  // Uch urinishdan keyin to'xtaymiz — undan pastda rasm o'qilmay qoladi.
  for (let i = 0; i < 3 && dataUrlBytes(dataUrl) > SUPPORT_MAX_IMAGE_BYTES; i++) {
    quality -= 0.2;
    dataUrl = canvas.toDataURL('image/jpeg', Math.max(0.3, quality));
  }

  const sizeBytes = dataUrlBytes(dataUrl);
  if (sizeBytes > SUPPORT_MAX_IMAGE_BYTES) {
    const mb = (SUPPORT_MAX_IMAGE_BYTES / 1024 / 1024).toFixed(1);
    throw new ImageError(`Rasm juda katta (${mb} MB dan oshdi). Kichikroq rasm tanlang.`);
  }

  if (!(SUPPORT_ALLOWED_IMAGE_MIMES as readonly string[]).includes('image/jpeg')) {
    throw new ImageError('Rasm turi qo\'llab-quvvatlanmaydi');
  }

  return {
    dataUrl,
    fileName: file.name.replace(/\.[^.]+$/, '') + '.jpg',
    sizeBytes,
    originalBytes: file.size,
  };
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

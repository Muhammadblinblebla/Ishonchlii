'use client';

import { useRef, useState } from 'react';
import { SUPPORT_MAX_IMAGE_BYTES } from '@escrowuz/shared';
import { ImageError, formatBytes, prepareImage, type PreparedImage } from '@/lib/image';

/**
 * Rasm tanlash va siqish.
 *
 * Siqish TANLANGAN ZAHOTI bo'ladi — yuborish tugmasi bosilganda emas.
 * Shunda foydalanuvchi hajmni oldindan ko'radi va katta bo'lsa boshqa
 * rasm tanlaydi; "yuborish" bosgandan keyin xato chiqishi yomonroq.
 */
export function ImagePicker({
  image,
  onChange,
  onError,
}: {
  image: PreparedImage | null;
  onChange: (img: PreparedImage | null) => void;
  onError: (msg: string | null) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  return (
    <div>
      <label className="label">Rasm (ixtiyoriy)</label>

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={async (e) => {
          const file = e.target.files?.[0];
          // Maydonni darhol tozalaymiz — bir xil faylni qayta tanlash ishlasin
          e.target.value = '';
          if (!file) return;

          setBusy(true);
          onError(null);
          try {
            onChange(await prepareImage(file));
          } catch (err) {
            onError(err instanceof ImageError ? err.message : 'Rasmni tayyorlab bo\'lmadi');
          } finally {
            setBusy(false);
          }
        }}
      />

      {image ? (
        <div className="flex items-center gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={image.dataUrl}
            alt=""
            className="h-16 w-16 shrink-0 rounded object-cover"
          />
          <div className="min-w-0 flex-1 text-sm">
            <p className="truncate text-slate-900">{image.fileName}</p>
            <p className="text-xs text-slate-500">
              {formatBytes(image.originalBytes)} → {formatBytes(image.sizeBytes)}
            </p>
          </div>
          <button
            type="button"
            className="btn-secondary shrink-0 py-2 text-xs"
            onClick={() => onChange(null)}
          >
            O&apos;chirish
          </button>
        </div>
      ) : (
        <button
          type="button"
          className="btn-secondary w-full sm:w-auto"
          disabled={busy}
          onClick={() => inputRef.current?.click()}
        >
          {busy ? 'Tayyorlanmoqda…' : '📷 Rasm tanlash'}
        </button>
      )}

      <p className="mt-1 text-xs text-slate-500">
        Skrinshot muammoni tushuntirishga juda yordam beradi. Rasm avtomatik
        siqiladi (eng ko&apos;pi {(SUPPORT_MAX_IMAGE_BYTES / 1024 / 1024).toFixed(0)} MB).
      </p>
    </div>
  );
}

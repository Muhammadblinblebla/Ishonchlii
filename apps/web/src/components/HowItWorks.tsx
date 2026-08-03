'use client';

import { useState } from 'react';

/**
 * "Bu qanday ishlaydi" — yopilib-ochiladigan yordam bloki.
 *
 * Dashboard va savdo sahifasida ko'rsatiladi. Foydalanuvchi bir marta
 * yopsa, `localStorage` da eslab qolinadi — har safar bezovta qilmasin.
 */
export function HowItWorks({ storageKey = 'escrowuz.howitworks' }: { storageKey?: string }) {
  const [hidden, setHidden] = useState<boolean | null>(null);

  // Birinchi renderda localStorage o'qilmaydi (server tomonida yo'q),
  // shuning uchun `null` — hech narsa ko'rsatilmaydi, keyin aniqlanadi.
  if (hidden === null && typeof window !== 'undefined') {
    setHidden(window.localStorage.getItem(storageKey) === 'hidden');
    return null;
  }
  if (hidden !== false) return null;

  return (
    <section className="card border-brand-200 bg-brand-50 p-5">
      <div className="flex items-start justify-between gap-4">
        <h2 className="font-semibold text-brand-900">Bu qanday ishlaydi?</h2>
        <button
          type="button"
          onClick={() => {
            window.localStorage.setItem(storageKey, 'hidden');
            setHidden(true);
          }}
          className="shrink-0 text-sm text-brand-700 hover:underline"
        >
          Yopish
        </button>
      </div>

      <ol className="mt-4 space-y-3 text-sm text-brand-900">
        {[
          ['Kelishasiz', 'Sotuvchi savdo yaratadi, xaridor shartlarni qabul qiladi.'],
          [
            'Xaridor pul tushiradi',
            'Pul platformada saqlanadi. Sotuvchi unga hali tegolmaydi.',
          ],
          ['Sotuvchi tovarni yuboradi', 'Trek-raqamni kiritadi, xaridor kuzatib turadi.'],
          [
            'Xaridor tasdiqlaydi',
            'Tovar joyida bo\'lsa tasdiqlaydi — shundagina pul sotuvchiga o\'tadi.',
          ],
        ].map(([title, text], i) => (
          <li key={title} className="flex gap-3">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-600 text-xs font-semibold text-white">
              {i + 1}
            </span>
            <span>
              <strong className="font-medium">{title}.</strong> {text}
            </span>
          </li>
        ))}
      </ol>

      <p className="mt-4 border-t border-brand-200 pt-3 text-sm text-brand-800">
        Muammo chiqsa <strong>nizo oching</strong> — pul muzlatilgan holda qoladi va
        mustaqil arbitr ikkala tomonni tinglab qaror qabul qiladi.
      </p>
    </section>
  );
}

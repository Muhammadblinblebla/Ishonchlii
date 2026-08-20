'use client';

import { useEffect, useState } from 'react';
import { tokens } from '@/lib/api';

/**
 * Avtorizatsiya talab qiladigan rasmni ko'rsatadi.
 *
 * Oddiy `<img src="...">` ISHLAMAYDI: brauzer rasm so'rovida
 * `Authorization` sarlavhasini yubormaydi, server esa 404 qaytaradi.
 *
 * Shuning uchun rasm `fetch` bilan token qo'shib olinadi va `blob:`
 * URL sifatida ko'rsatiladi. URL komponent yopilganda bo'shatiladi —
 * aks holda xotira sizib ketardi.
 */
export function AuthImage({ url, alt }: { url: string; alt: string }) {
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let objectUrl: string | null = null;
    let cancelled = false;

    void (async () => {
      try {
        const res = await fetch(url, {
          headers: tokens.access ? { Authorization: `Bearer ${tokens.access}` } : {},
        });
        if (!res.ok) throw new Error(String(res.status));
        const blob = await res.blob();
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setSrc(objectUrl);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [url]);

  if (failed) {
    return <p className="text-xs text-slate-400">Rasmni yuklab bo&apos;lmadi</p>;
  }
  if (!src) {
    return <div className="h-40 w-full max-w-xs animate-pulse rounded-lg bg-slate-100" />;
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <a href={src} target="_blank" rel="noreferrer">
      <img
        src={src}
        alt={alt}
        className="max-h-64 w-auto max-w-full rounded-lg border border-slate-200"
      />
    </a>
  );
}

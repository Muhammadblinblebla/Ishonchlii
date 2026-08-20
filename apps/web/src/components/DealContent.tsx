'use client';

import { useState } from 'react';
import { CONTENT_KINDS, uz } from '@escrowuz/shared';
import { api, ApiRequestError, type DigitalContentInfo } from '@/lib/api';
import { ErrorBox, Field } from '@/components/ui';

// ─── SOTUVCHI: mahsulotni topshirish ─────────────────────────────────────────

const KIND_LABELS = {
  link: uz.digital.kindLink,
  text: uz.digital.kindText,
  file: uz.digital.kindFile,
} as const;

/**
 * Sotuvchi raqamli mahsulotni topshiradi.
 *
 * ⚠️ Topshirilgandan keyin O'ZGARTIRIB BO'LMAYDI (baza triggeri) —
 * shuning uchun tasdiqlash oynasi ko'rsatiladi.
 */
export function ContentHandoverForm({
  dealId,
  version,
  onDone,
}: {
  dealId: string;
  version: number;
  onDone: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<'link' | 'text' | 'file'>('link');
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) {
    return (
      <button className="btn-primary" onClick={() => setOpen(true)}>
        {uz.digital.handoverTitle}
      </button>
    );
  }

  return (
    <form
      className="w-full space-y-3 rounded-lg border border-slate-200 bg-white p-4"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        try {
          await api.deals.handoverContent(dealId, { kind, value }, version);
          setValue('');
          await onDone();
          setOpen(false);
        } catch (err) {
          setError(err instanceof ApiRequestError ? err.message : uz.common.error);
        } finally {
          setBusy(false);
        }
      }}
    >
      <ErrorBox message={error} />

      <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-900">
        ⚠️ {uz.digital.handoverHint}
      </p>

      <Field label={uz.digital.kind}>
        <div className="grid grid-cols-3 gap-2">
          {CONTENT_KINDS.map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setKind(k)}
              className={kind === k ? 'choice-on' : 'choice-off'}
            >
              {KIND_LABELS[k]}
            </button>
          ))}
        </div>
      </Field>

      {kind === 'link' && (
        <Field label={uz.digital.link} hint={uz.digital.linkHint}>
          <input
            className="input"
            type="url"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            required
            placeholder={uz.digital.linkPlaceholder}
            autoCapitalize="none"
            spellCheck={false}
          />
        </Field>
      )}

      {kind === 'text' && (
        <Field label={uz.digital.text}>
          <textarea
            className="input min-h-32"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            required
            maxLength={5000}
            placeholder={uz.digital.textPlaceholder}
          />
        </Field>
      )}

      {kind === 'file' && (
        <Field label={uz.digital.file} hint={uz.digital.fileHint}>
          {/*
            Fayl yuklash Supabase Storage sozlangandan keyin ishlaydi.
            Hozircha havola ishlatilsin — yarim ishlaydigan tugmadan
            ko'ra aniq tushuntirish yaxshiroq.
          */}
          <p className="rounded-lg bg-slate-50 px-3 py-3 text-sm text-slate-600">
            Fayl yuklash hali yoqilmagan. Hozircha faylni Google Drive'ga
            yuklab, <strong>Havola</strong> variantini tanlang.
          </p>
        </Field>
      )}

      <div className="grid gap-2 sm:flex">
        <button
          type="submit"
          className="btn-primary"
          disabled={busy || kind === 'file' || !value.trim()}
        >
          {busy ? uz.common.loading : uz.digital.handoverButton}
        </button>
        <button type="button" className="btn-secondary" onClick={() => setOpen(false)}>
          {uz.common.cancel}
        </button>
      </div>
    </form>
  );
}

// ─── XARIDOR: mahsulotni olish ───────────────────────────────────────────────

/**
 * Xaridor mahsulotni ochib ko'radi.
 *
 * Ma'lumot sahifa yuklanganda EMAS, tugma bosilganda so'raladi: server
 * "birinchi ochilgan vaqt"ni yozib qo'yadi va u nizoda dalil bo'ladi.
 */
export function ContentCard({ dealId }: { dealId: string }) {
  const [data, setData] = useState<DigitalContentInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API HTTPS talab qiladi — qiymat ekranda ko'rinib turibdi
    }
  }

  return (
    <section className="card border-brand-200 p-4 sm:p-6">
      <h2 className="font-semibold text-slate-900">{uz.digital.contentTitle}</h2>

      {error && (
        <div className="mt-3">
          <ErrorBox message={error} />
        </div>
      )}

      {!data ? (
        <>
          <p className="mt-2 text-sm text-slate-600">{uz.digital.downloadHint}</p>
          <button
            className="btn-primary mt-4"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setError(null);
              try {
                setData(await api.deals.content(dealId));
              } catch (err) {
                setError(err instanceof ApiRequestError ? err.message : uz.common.error);
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? uz.common.loading : uz.digital.open}
          </button>
        </>
      ) : (
        <div className="mt-4 space-y-3">
          {data.kind === 'link' && (
            <div className="rounded-lg bg-slate-50 p-3">
              <p className="text-xs text-slate-500">{uz.digital.link}</p>
              <a
                href={data.value}
                target="_blank"
                rel="noopener noreferrer"
                className="break-anywhere mt-1 block font-medium text-brand-600 hover:underline"
              >
                {data.value}
              </a>
              <button
                type="button"
                className="btn-secondary mt-3 text-xs"
                onClick={() => void copy(data.value)}
              >
                {copied ? uz.common.copied : uz.common.copy}
              </button>
            </div>
          )}

          {data.kind === 'text' && (
            <div className="rounded-lg bg-slate-50 p-3">
              <p className="text-xs text-slate-500">{uz.digital.text}</p>
              <pre className="break-anywhere mt-1 whitespace-pre-wrap font-sans text-sm text-slate-900">
                {data.value}
              </pre>
              <button
                type="button"
                className="btn-secondary mt-3 text-xs"
                onClick={() => void copy(data.value)}
              >
                {copied ? uz.common.copied : uz.common.copy}
              </button>
            </div>
          )}

          {data.kind === 'file' && (
            <div className="rounded-lg bg-slate-50 p-3">
              <p className="text-xs text-slate-500">{data.fileName ?? uz.digital.file}</p>
              <a href={data.value} className="btn-primary mt-2 inline-flex" download>
                {uz.digital.download}
              </a>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

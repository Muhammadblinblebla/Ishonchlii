'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { useRequireAuth } from '@/components/AuthProvider';
import { EmptyState, ErrorBox, Field, Spinner } from '@/components/ui';
import { uz } from '@escrowuz/shared';
import { api, ApiRequestError, type AdminDispute } from '@/lib/api';
import { formatAmount, formatDate } from '@/lib/format';

export default function AdminDisputesPage() {
  const { user, loading: authLoading } = useRequireAuth();
  const [disputes, setDisputes] = useState<AdminDispute[]>([]);
  const [stats, setStats] = useState<{ escrowTiyin: string; activeDeals: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [d, s] = await Promise.all([api.admin.disputes('open'), api.admin.stats()]);
      setDisputes(d.disputes);
      setStats(s);
      setError(null);
    } catch (err) {
      setError(
        err instanceof ApiRequestError && err.status === 403
          ? 'Bu bo\'lim faqat administratorlar uchun'
          : err instanceof ApiRequestError
            ? err.message
            : 'Yuklab bo\'lmadi',
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (user) void load();
  }, [user, load]);

  if (authLoading || loading) return <Spinner />;
  if (!user) return null;

  if (user.role !== 'admin') {
    return <ErrorBox message="Bu bo'lim faqat administratorlar uchun" />;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Nizolar</h1>
        <p className="mt-1 text-sm text-slate-500">
          Har bir nizoda pul muzlatilgan holda turibdi. Qaror qabul qilinmaguncha
          hech kim uni ola olmaydi.
        </p>
      </div>

      {/*
        Admin panelining roli o'zgardi: bu KUZATUV oynasi, ish joyi emas.
        Nizolarni tizim o'zi hal qiladi — bu yerdagi tugmalar faqat
        tizim qarori aniq noto'g'ri bo'lganda ishlatiladi.
      */}
      <section className="card border-brand-200 bg-brand-50 p-4 sm:p-5">
        <p className="font-medium text-brand-900">{uz.admin.autoTitle}</p>
        <p className="mt-1 text-sm leading-relaxed text-brand-800">{uz.admin.autoText}</p>
        <details className="mt-3">
          <summary className="cursor-pointer text-xs font-medium text-brand-700">
            Tizim qanday qaror qabul qiladi?
          </summary>
          <ul className="mt-2 space-y-1.5 text-xs leading-relaxed text-brand-900">
            <li>
              <strong>Sotuvchi hech narsa topshirmagan</strong> → pul to&apos;liq
              xaridorga
            </li>
            <li>
              <strong>&quot;Topshirdim&quot; bosilgan, lekin izi yo&apos;q</strong> → pul
              to&apos;liq xaridorga
            </li>
            <li>
              <strong>Topshirilgan, xaridor ochib ko&apos;rmagan</strong> → pul sotuvchiga
            </li>
            <li>
              <strong>Ikkalasida ham dalil bor</strong> → teng bo&apos;linadi (tizim
              mahsulot ichini tekshira olmaydi)
            </li>
          </ul>
        </details>
      </section>

      <ErrorBox message={error} />

      {stats && (
        <div className="grid gap-4 sm:grid-cols-3">
          <Stat label="Hal qilinmagan nizolar" value={String(disputes.length)} warn={disputes.length > 0} />
          <Stat label="Faol savdolar" value={String(stats.activeDeals)} />
          <Stat label="Escrowda turgan pul" value={formatAmount(stats.escrowTiyin)} />
        </div>
      )}

      {disputes.length === 0 ? (
        <EmptyState
          title="Hal qilinmagan nizo yo'q"
          text="Yangi nizo ochilsa shu yerda paydo bo'ladi."
        />
      ) : (
        <ul className="space-y-4">
          {disputes.map((dispute) => (
            <li key={dispute.id} className="card p-4 sm:p-6">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <Link
                    href={`/deals/${dispute.deal.id}`}
                    className="font-medium text-slate-900 hover:underline"
                  >
                    {dispute.deal.title}
                  </Link>
                  <p className="break-anywhere mt-1 text-sm text-slate-500">
                    {dispute.opener.fullName} ochgan · {formatDate(dispute.createdAt)}
                  </p>
                </div>
                <p className="tabular shrink-0 text-lg font-semibold text-slate-900">
                  {formatAmount(dispute.deal.amountTiyin)}
                </p>
              </div>

              <div className="mt-4 rounded-lg bg-slate-50 p-4">
                <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                  Nizo sababi
                </p>
                <p className="mt-1.5 whitespace-pre-wrap text-sm text-slate-700">
                  {dispute.reason}
                </p>
              </div>

              {openId === dispute.id ? (
                <ResolveForm
                  dispute={dispute}
                  onCancel={() => setOpenId(null)}
                  onDone={async () => {
                    setOpenId(null);
                    await load();
                  }}
                />
              ) : (
                <button className="btn-primary mt-4" onClick={() => setOpenId(dispute.id)}>
                  Qaror qabul qilish
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Stat({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className={`card p-4 sm:p-5 ${warn ? 'border-amber-300 bg-amber-50' : ''}`}>
      <p className="text-sm text-slate-500">{label}</p>
      <p className={`tabular mt-1 text-2xl font-semibold ${warn ? 'text-amber-900' : 'text-slate-900'}`}>
        {value}
      </p>
    </div>
  );
}

type Resolution = 'buyer' | 'seller' | 'split';

function ResolveForm({
  dispute,
  onCancel,
  onDone,
}: {
  dispute: AdminDispute;
  onCancel: () => void;
  onDone: () => Promise<void>;
}) {
  const [resolution, setResolution] = useState<Resolution>('buyer');
  const [buyerPercent, setBuyerPercent] = useState(50);
  const [note, setNote] = useState('');
  const [preview, setPreview] = useState<{
    toBuyerTiyin: string;
    toSellerTiyin: string;
    toPlatformTiyin: string;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Taqsimotni SERVERDAN olamiz — admin foizni kiritganda aynan qancha so'm
  // kimga ketishini ko'rishi kerak, xayolida hisoblamasin.
  useEffect(() => {
    if (resolution !== 'split') {
      setPreview(null);
      return;
    }
    const timer = setTimeout(() => {
      void api.admin
        .previewSplit(dispute.id, buyerPercent)
        .then((r) => setPreview(r.split))
        .catch(() => setPreview(null));
    }, 250);
    return () => clearTimeout(timer);
  }, [resolution, buyerPercent, dispute.id]);

  return (
    <form
      className="mt-5 space-y-4 rounded-lg border border-slate-200 bg-white p-5"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        try {
          await api.admin.resolve(dispute.id, {
            resolution,
            ...(resolution === 'split' ? { buyerSharePercent: buyerPercent } : {}),
            note,
          });
          await onDone();
        } catch (err) {
          setError(err instanceof ApiRequestError ? err.message : 'Xatolik yuz berdi');
          setBusy(false);
        }
      }}
    >
      <ErrorBox message={error} />

      <Field label="Pul kimga ketsin?">
        <div className="grid gap-2 sm:grid-cols-3">
          {(
            [
              { id: 'buyer', label: 'Xaridorga qaytarish' },
              { id: 'seller', label: 'Sotuvchiga berish' },
              { id: 'split', label: "Bo'lib berish" },
            ] as const
          ).map((opt) => (
            <button
              key={opt.id}
              type="button"
              onClick={() => setResolution(opt.id)}
              className={resolution === opt.id ? 'choice-on' : 'choice-off'}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </Field>

      {resolution === 'split' && (
        <Field label={`Xaridor ulushi: ${buyerPercent}%`}>
          <input
            type="range"
            min={0}
            max={100}
            step={5}
            value={buyerPercent}
            onChange={(e) => setBuyerPercent(Number(e.target.value))}
            className="w-full accent-brand-600"
          />
          {preview && (
            <dl className="mt-3 space-y-1.5 rounded-lg bg-slate-50 p-3 text-sm">
              <div className="flex justify-between">
                <dt className="text-slate-600">Xaridorga</dt>
                <dd className="tabular font-medium">{formatAmount(preview.toBuyerTiyin)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-slate-600">Sotuvchiga</dt>
                <dd className="tabular font-medium">{formatAmount(preview.toSellerTiyin)}</dd>
              </div>
              <div className="flex justify-between border-t border-slate-200 pt-1.5 text-xs">
                <dt className="text-slate-500">Platforma komissiyasi</dt>
                <dd className="tabular text-slate-500">
                  {formatAmount(preview.toPlatformTiyin)}
                </dd>
              </div>
            </dl>
          )}
        </Field>
      )}

      <Field
        label="Qaror sababi"
        hint="Ikkala tomon ham buni o'qiydi. Kamida 20 belgi."
      >
        <textarea
          className="input min-h-24"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          required
          minLength={20}
          maxLength={2000}
          placeholder="Nima uchun shunday qaror qabul qilindi…"
        />
      </Field>

      <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
        Qaror qabul qilingach pul ko&apos;chiriladi va buni <strong>ortga qaytarib
        bo&apos;lmaydi</strong>.
      </div>

      <div className="flex gap-2">
        <button type="submit" className="btn-primary" disabled={busy || note.trim().length < 20}>
          {busy ? 'Bajarilmoqda…' : 'Qarorni tasdiqlash'}
        </button>
        <button type="button" className="btn-secondary" onClick={onCancel} disabled={busy}>
          Bekor qilish
        </button>
      </div>
    </form>
  );
}

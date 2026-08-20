'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRequireAuth } from '@/components/AuthProvider';
import { EmptyState, ErrorBox, Field, Spinner } from '@/components/ui';
import { api, ApiRequestError, type AdminPayout } from '@/lib/api';
import { formatAmount, formatDate } from '@/lib/format';

type Tab = 'pending' | 'completed' | 'failed';

/**
 * QO'LDA TO'LOV PANELI.
 *
 * To'lov tizimi (Click) pul chiqarishni qo'llab-quvvatlamaydi, shuning uchun
 * sotuvchiga to'lov bank orqali bajariladi. Bu ekran shu ish uchun:
 * kimga qancha o'tkazish kerakligini ko'rsatadi va bajarilganini qayd etadi.
 */
export default function AdminPayoutsPage() {
  const { user, loading: authLoading } = useRequireAuth();
  const [payouts, setPayouts] = useState<AdminPayout[]>([]);
  const [stats, setStats] = useState<{
    pendingPayoutTiyin: string;
    providerBalanceTiyin: string | null;
    escrowTiyin: string;
    shortfallTiyin: string | null;
  } | null>(null);
  const [tab, setTab] = useState<Tab>('pending');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [p, s] = await Promise.all([api.admin.payouts(tab), api.admin.stats()]);
      setPayouts(p.payouts);
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
  }, [tab]);

  useEffect(() => {
    if (user) void load();
  }, [user, load]);

  if (authLoading || loading) return <Spinner />;
  if (!user) return null;
  if (user.role !== 'admin') return <ErrorBox message="Bu bo'lim faqat administratorlar uchun" />;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Pul yechish so&apos;rovlari</h1>
        <p className="mt-1 text-sm text-slate-500">
          Sotuvchilarga pulni bank orqali o&apos;zingiz o&apos;tkazasiz, so&apos;ng bu yerda
          belgilaysiz.
        </p>
      </div>

      <ErrorBox message={error} />

      {/* ── Escrow himoyasi ────────────────────────────────────────────────── */}
      {stats?.shortfallTiyin && (
        <div className="card border-red-300 bg-red-50 p-4 sm:p-5">
          <p className="font-semibold text-red-900">⚠️ To&apos;lov tizimi balansi yetarli emas</p>
          <p className="mt-2 text-sm leading-relaxed text-red-800">
            Escrowda <strong>{formatAmount(stats.escrowTiyin)}</strong> xaridorlar puli turibdi,
            lekin to&apos;lov tizimi balansingizda{' '}
            <strong>{formatAmount(stats.providerBalanceTiyin ?? '0')}</strong> bor.
            <br />
            <strong>{formatAmount(stats.shortfallTiyin)}</strong> yetishmayapti — savdo bekor
            bo&apos;lsa xaridorga qaytarishga pul qolmaydi.
          </p>
          <p className="mt-2 text-sm text-red-800">
            Kabinetdan pul yechishni to&apos;xtating yoki hisobni to&apos;ldiring.
          </p>
        </div>
      )}

      {stats && (
        <div className="grid gap-4 sm:grid-cols-3">
          <Stat label="Kutilayotgan so'rovlar" value={formatAmount(stats.pendingPayoutTiyin)} />
          <Stat label="Escrowdagi pul (tegilmaydi)" value={formatAmount(stats.escrowTiyin)} />
          <Stat
            label="To'lov tizimi balansi"
            value={
              stats.providerBalanceTiyin === null
                ? '—'
                : formatAmount(stats.providerBalanceTiyin)
            }
          />
        </div>
      )}

      {/* ── Tablar ─────────────────────────────────────────────────────────── */}
      {/* Tor ekranda tablar sig'masa gorizontal aylanadi */}
      <div
        className="-mx-4 flex gap-1 overflow-x-auto border-b border-slate-200 px-4 sm:mx-0 sm:px-0"
        role="tablist"
      >
        {(
          [
            { id: 'pending', label: 'Kutilmoqda' },
            { id: 'completed', label: 'Bajarilgan' },
            { id: 'failed', label: 'Bekor qilingan' },
          ] as const
        ).map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => {
              setTab(t.id);
              setLoading(true);
            }}
            className={`-mb-px shrink-0 whitespace-nowrap border-b-2 px-4 py-3 text-sm transition-colors ${
              tab === t.id
                ? 'border-brand-600 font-medium text-brand-700'
                : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {payouts.length === 0 ? (
        <EmptyState
          title="So'rov yo'q"
          text={
            tab === 'pending'
              ? 'Sotuvchi pul yechishni so\'raganda shu yerda paydo bo\'ladi.'
              : 'Bu bo\'limda hozircha yozuv yo\'q.'
          }
        />
      ) : (
        <ul className="space-y-4">
          {payouts.map((payout) => (
            <PayoutCard key={payout.id} payout={payout} onDone={load} />
          ))}
        </ul>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="card p-4 sm:p-5">
      <p className="text-sm text-slate-500">{label}</p>
      <p className="tabular mt-1 text-xl font-semibold text-slate-900">{value}</p>
    </div>
  );
}

function PayoutCard({ payout, onDone }: { payout: AdminPayout; onDone: () => Promise<void> }) {
  const [mode, setMode] = useState<'none' | 'complete' | 'reject'>('none');
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isPending = payout.status === 'pending' || payout.status === 'processing';

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (mode === 'complete') await api.admin.completePayout(payout.id, value);
      else await api.admin.rejectPayout(payout.id, value);
      await onDone();
      setMode('none');
      setValue('');
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Xatolik yuz berdi');
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="card p-4 sm:p-6">
      {/* Mobilda ustma-ust, keng ekranda yonma-yon */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="font-medium text-slate-900">{payout.user.fullName}</p>
          <p className="break-anywhere mt-0.5 text-sm text-slate-500">{payout.user.email}</p>
          {payout.user.phone && (
            <p className="text-sm text-slate-500">{payout.user.phone}</p>
          )}
          <p className="mt-2 text-xs text-slate-400">
            So&apos;ralgan: {formatDate(payout.createdAt)}
          </p>
        </div>

        <div className="shrink-0 sm:text-right">
          <p className="tabular text-xl font-semibold text-slate-900">
            {formatAmount(payout.amountTiyin)}
          </p>
          <p className="tabular mt-1 font-mono text-sm text-slate-600">{payout.destination}</p>
        </div>
      </div>

      {payout.status === 'completed' && (
        <p className="mt-4 rounded-lg bg-emerald-50 px-4 py-2.5 text-sm text-emerald-800">
          ✓ O&apos;tkazilgan{payout.providerRef ? ` — ${payout.providerRef}` : ''}
          {payout.processedAt && ` · ${formatDate(payout.processedAt)}`}
        </p>
      )}

      {payout.status === 'failed' && (
        <p className="mt-4 rounded-lg bg-slate-100 px-4 py-2.5 text-sm text-slate-700">
          Bekor qilingan — pul hisobga qaytarilgan
          {payout.failReason ? `. Sabab: ${payout.failReason}` : ''}
        </p>
      )}

      {isPending && mode === 'none' && (
        <>
          <div className="mt-4 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-900">
            Bankdan <strong>{formatAmount(payout.amountTiyin)}</strong> ni{' '}
            <strong className="font-mono">{payout.destination}</strong> raqamiga o&apos;tkazing,
            so&apos;ng «O&apos;tkazdim» bosing.
            <br />
            <span className="text-xs">
              Karta raqami xavfsizlik uchun qisman yashirilgan — to&apos;liq raqamni sotuvchidan
              so&apos;rang yoki u bilan bog&apos;laning.
            </span>
          </div>
          <div className="mt-4 grid gap-2 sm:flex sm:flex-wrap">
            <button className="btn-primary" onClick={() => setMode('complete')}>
              O&apos;tkazdim
            </button>
            <button className="btn-danger" onClick={() => setMode('reject')}>
              Bajara olmadim
            </button>
          </div>
        </>
      )}

      {isPending && mode !== 'none' && (
        <form onSubmit={submit} className="mt-4 space-y-3 rounded-lg border border-slate-200 p-4">
          <ErrorBox message={error} />

          {mode === 'complete' ? (
            <Field
              label="O'tkazma raqami yoki izoh"
              hint="Keyin tekshirish uchun kerak bo'ladi. Masalan: «Bank chek #12345»"
            >
              <input
                className="input"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                required
                minLength={3}
                autoFocus
              />
            </Field>
          ) : (
            <Field label="Nima uchun bajarilmadi?" hint="Pul sotuvchi hisobiga qaytariladi">
              <textarea
                className="input min-h-20"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                required
                minLength={10}
                autoFocus
              />
            </Field>
          )}

          <div className="grid gap-2 sm:flex">
            <button
              type="submit"
              className={mode === 'complete' ? 'btn-primary' : 'btn-danger'}
              disabled={busy}
            >
              {busy ? 'Bajarilmoqda…' : mode === 'complete' ? 'Tasdiqlash' : 'Bekor qilish'}
            </button>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => {
                setMode('none');
                setError(null);
              }}
              disabled={busy}
            >
              Orqaga
            </button>
          </div>
        </form>
      )}
    </li>
  );
}

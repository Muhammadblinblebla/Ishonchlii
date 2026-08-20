'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { DEAL_TYPE_RULES, KEYWORD_RULES, dealTypeRule, uz } from '@escrowuz/shared';
import { useRequireAuth } from '@/components/AuthProvider';
import { ErrorBox, Field, Spinner } from '@/components/ui';
import { api, ApiRequestError, type Deal, type DealDetail } from '@/lib/api';
import { formatAmount } from '@/lib/format';

type Found = {
  deal: Deal & { seller: { id: string; fullName: string } };
  breakdown: DealDetail['breakdown'];
};

/**
 * Xaridor savdoni KALIT SO'Z bilan topadi.
 *
 * Ikki qadam:
 *   1. Kalit so'zni kiritadi → nima sotilayotgani va NARXI ko'rinadi
 *   2. "To'lash" bosadi → savdo band qilinadi va to'lovga o'tadi
 *
 * Ikkinchi qadam ALOHIDA: xaridor to'lashdan oldin nima olayotganini va
 * qancha to'lashini ko'rishi kerak. Darhol band qilib yuborish — odamni
 * o'ylab ko'rishga vaqt bermaslik degani.
 */
export default function FindDealPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useRequireAuth();

  const [keyword, setKeyword] = useState('');
  const [found, setFound] = useState<Found | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (authLoading) return <Spinner />;
  if (!user) return null;

  async function search(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setFound(null);
    try {
      setFound(await api.deals.find(keyword));
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : uz.common.error);
    } finally {
      setBusy(false);
    }
  }

  async function claim() {
    if (!found) return;
    setBusy(true);
    setError(null);
    try {
      const { deal } = await api.deals.claim(found.deal.id);
      router.push(`/deals/${deal.id}`);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : uz.common.error);
      setBusy(false);
    }
  }

  const rule = found ? dealTypeRule(found.deal.dealType) : null;

  return (
    <div className="mx-auto max-w-lg">
      <h1 className="text-2xl font-semibold text-slate-900">{uz.deal.findTitle}</h1>
      <p className="mt-1 text-sm text-slate-500">{uz.deal.findHint}</p>

      <form onSubmit={search} className="card mt-6 space-y-4 p-4 sm:p-6">
        <ErrorBox message={error} />

        <Field label={uz.deal.keyword}>
          <input
            className="input font-mono text-lg"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value.trim())}
            required
            minLength={KEYWORD_RULES.minLength}
            maxLength={KEYWORD_RULES.maxLength}
            placeholder={uz.deal.keywordPlaceholder}
            autoCapitalize="none"
            spellCheck={false}
            autoFocus
          />
        </Field>

        <button type="submit" className="btn-primary w-full py-3" disabled={busy || !keyword}>
          {busy ? uz.common.loading : uz.deal.findButton}
        </button>
      </form>

      {/* ── Topilgan savdo ─────────────────────────────────────────────────── */}
      {found && rule && (
        <section className="card mt-6 p-4 sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <h2 className="break-anywhere text-lg font-semibold text-slate-900">
                {found.deal.title}
              </h2>
              <p className="mt-0.5 text-sm text-slate-500">
                {rule.label}
                {found.deal.game && ` · ${found.deal.game}`}
              </p>
            </div>
          </div>

          {found.deal.description && (
            <p className="break-anywhere mt-3 whitespace-pre-wrap text-sm text-slate-700">
              {found.deal.description}
            </p>
          )}

          <p className="mt-3 text-sm text-slate-500">
            Sotuvchi: <span className="text-slate-900">{found.deal.seller.fullName}</span>
          </p>

          {/* ── Qancha to'laysiz ────────────────────────────────────────── */}
          <div className="mt-5 rounded-lg bg-slate-50 p-4">
            <div className="flex items-baseline justify-between">
              <span className="font-medium text-slate-900">{uz.deal.buyerPays}</span>
              <span className="tabular text-xl font-semibold text-slate-900">
                {formatAmount(found.breakdown.buyerPaysTiyin)}
              </span>
            </div>
            <p className="mt-2 text-xs text-slate-500">
              Ichida bank komissiyasi va xizmat haqqi bor. Sotuvchi{' '}
              {formatAmount(found.breakdown.sellerReceivesTiyin)} oladi.
            </p>
          </div>

          {/* ── Nima bo'ladi ────────────────────────────────────────────── */}
          <p className="mt-4 rounded-lg border border-brand-200 bg-brand-50 px-4 py-3 text-xs leading-relaxed text-brand-900">
            To&apos;lasangiz pul <strong>platformada muzlatiladi</strong> — sotuvchi unga
            tegolmaydi.{' '}
            {found.deal.dealType === 'DIGITAL'
              ? `Mahsulotni olasiz va tekshirish uchun ${rule.autoReleaseHours} soat vaqtingiz bo'ladi.`
              : found.deal.dealType === 'GAME_ACCOUNT'
                ? `Sotuvchi bilan chat ochiladi. Tekshirish uchun ${rule.autoReleaseHours / 24} kun vaqtingiz bo'ladi.`
                : `Tovar yetib borgach tasdiqlaysiz. Buning uchun ${rule.autoReleaseHours / 24} kun vaqtingiz bo'ladi.`}{' '}
            Muammo bo&apos;lsa nizo ochasiz va pul muzlatilgan holda qoladi.
          </p>

          <button
            type="button"
            className="btn-primary mt-5 w-full py-3"
            disabled={busy}
            onClick={() => void claim()}
          >
            {busy ? uz.common.loading : uz.deal.claimButton}
          </button>
        </section>
      )}

      {/* Sotuvchi uchun eslatma */}
      {!found && (
        <p className="mt-6 text-center text-sm text-slate-500">
          Sotmoqchimisiz?{' '}
          <a href="/deals/new" className="font-medium text-brand-600 hover:underline">
            {uz.nav.newDeal}
          </a>
        </p>
      )}
    </div>
  );
}

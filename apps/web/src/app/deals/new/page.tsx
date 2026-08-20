'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import {
  COMMISSION_POLICY,
  DEAL_TYPES,
  DEAL_TYPE_RULES,
  KEYWORD_RULES,
  type DealType,
  uz,
} from '@escrowuz/shared';
import { useRequireAuth } from '@/components/AuthProvider';
import { ErrorBox, Field, Spinner } from '@/components/ui';
import { api, ApiRequestError } from '@/lib/api';
import { formatAmount, groupDigits, soumToTiyin } from '@/lib/format';

type Payer = 'buyer' | 'seller' | 'split';

const PAYER_OPTIONS: Array<{ id: Payer; label: string }> = [
  { id: 'seller', label: uz.deal.payerSeller },
  { id: 'buyer', label: uz.deal.payerBuyer },
  { id: 'split', label: uz.deal.payerSplit },
];

const MIN_SOUM = COMMISSION_POLICY.minDealAmountTiyin / 100;
const MAX_SOUM = COMMISSION_POLICY.maxDealAmountTiyin / 100;

/**
 * Savdo yaratish — SOTUVCHI uchun.
 *
 * Xaridorning emaili SO'RALMAYDI. Sotuvchi kalit so'z o'ylab topadi va
 * uni xaridorga aytadi; xaridor o'sha so'zni saytga kiritib savdoni ochadi.
 */
export default function NewDealPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useRequireAuth();

  const [form, setForm] = useState({
    title: '',
    description: '',
    /** Foydalanuvchi SO'MDA kiritadi — tiyin ichki birlik. */
    amountSoum: '',
    commissionPayer: 'seller' as Payer,
    dealType: 'DIGITAL' as DealType,
    keyword: '',
  });
  const [preview, setPreview] = useState<{
    buyerPaysTiyin: string;
    sellerReceivesTiyin: string;
    commissionTiyin: string;
    providerFeeTiyin: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showWhy, setShowWhy] = useState(false);

  const amountTiyin = soumToTiyin(form.amountSoum);
  const amountValid = BigInt(amountTiyin) >= BigInt(COMMISSION_POLICY.minDealAmountTiyin);

  const typeRule = DEAL_TYPE_RULES[form.dealType];
  const keywordValid =
    form.keyword.length >= KEYWORD_RULES.minLength &&
    form.keyword.length <= KEYWORD_RULES.maxLength &&
    KEYWORD_RULES.pattern.test(form.keyword);

  // Summalarni SERVERDAN olamiz — mijozda hisoblasak, server bilan
  // farq qilib qolishi mumkin va foydalanuvchi boshqa raqam ko'radi.
  useEffect(() => {
    if (!amountValid) {
      setPreview(null);
      return;
    }
    const timer = setTimeout(() => {
      void api.deals
        .preview(amountTiyin, form.commissionPayer)
        .then((r) => setPreview(r.breakdown))
        .catch(() => setPreview(null));
    }, 300);
    return () => clearTimeout(timer);
  }, [amountTiyin, amountValid, form.commissionPayer]);

  if (authLoading) return <Spinner />;
  if (!user) return null;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const { deal } = await api.deals.create({
        title: form.title,
        description: form.description,
        amountTiyin,
        commissionPayer: form.commissionPayer,
        dealType: form.dealType,
        keyword: form.keyword,
      });
      router.push(`/deals/${deal.id}`);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : uz.common.error);
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="text-2xl font-semibold text-slate-900">{uz.deal.createTitle}</h1>

      <form onSubmit={onSubmit} className="card mt-6 space-y-5 p-4 sm:p-6">
        <ErrorBox message={error} />

        {/* Savdo turi — birinchi savol, qolgan maydonlar shunga bog'liq */}
        <Field label={uz.deal.dealType}>
          <div className="grid gap-2 sm:grid-cols-3">
            {DEAL_TYPES.map((t) => {
              const rule = DEAL_TYPE_RULES[t];
              const active = form.dealType === t;
              return (
                <button
                  key={t}
                  type="button"
                  onClick={() => setForm((f) => ({ ...f, dealType: t }))}
                  className={`${active ? 'choice-on' : 'choice-off'} flex-col items-start gap-0.5 py-3 text-left`}
                >
                  <span className="font-medium">{rule.label}</span>
                  <span
                    className={`text-xs font-normal ${active ? 'text-brand-100' : 'text-slate-500'}`}
                  >
                    {rule.hint}
                  </span>
                </button>
              );
            })}
          </div>
        </Field>

        {/* ── KALIT SO'Z ─────────────────────────────────────────────────── */}
        <div className="rounded-lg border border-brand-200 bg-brand-50 p-4">
          <Field label={uz.deal.keyword} hint={uz.deal.keywordHint}>
            <input
              className="input font-mono"
              value={form.keyword}
              onChange={(e) => setForm((f) => ({ ...f, keyword: e.target.value.trim() }))}
              required
              minLength={KEYWORD_RULES.minLength}
              maxLength={KEYWORD_RULES.maxLength}
              placeholder={uz.deal.keywordPlaceholder}
              autoCapitalize="none"
              spellCheck={false}
            />
          </Field>

          {form.keyword.length > 0 && !keywordValid && (
            <p className="mt-1 text-xs text-red-600">{KEYWORD_RULES.patternHint}</p>
          )}

          <button
            type="button"
            onClick={() => setShowWhy((v) => !v)}
            className="mt-3 text-xs font-medium text-brand-700 hover:underline"
          >
            {showWhy ? '− ' : '+ '}
            {uz.deal.keywordWhy}
          </button>
          {showWhy && (
            <p className="mt-2 text-xs leading-relaxed text-brand-900">
              {uz.deal.keywordWhyText}
            </p>
          )}
        </div>

        <Field label={typeRule.text.itemLabel}>
          <input
            className="input"
            value={form.title}
            onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
            required
            minLength={3}
            maxLength={200}
            placeholder={typeRule.text.itemPlaceholder}
          />
        </Field>

        <Field
          label={uz.deal.description}
          hint="Nima sotayotganingizni aniq yozing — nizo chiqsa arbitr shu matnga qaraydi."
        >
          <textarea
            className="input min-h-24"
            value={form.description}
            onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
            maxLength={5000}
            placeholder={
              form.dealType === 'GAME_ACCOUNT'
                ? 'Daraja, o\'yinchilar, GP miqdori, bog\'langan pochta o\'zgartiriladimi…'
                : form.dealType === 'DIGITAL'
                  ? 'Nima kiradi: nechta dars, qancha sahifa, qanday format…'
                  : 'Holati, kafolat, yetkazib berish shartlari…'
            }
          />
        </Field>

        <Field
          label={`${uz.deal.amount} (${uz.common.soum})`}
          hint={`${MIN_SOUM.toLocaleString('ru-RU')} – ${MAX_SOUM.toLocaleString('ru-RU')} so'm`}
          {...(form.amountSoum && !amountValid
            ? { error: `Eng kam summa ${MIN_SOUM.toLocaleString('ru-RU')} so'm` }
            : {})}
        >
          <input
            className="input tabular text-lg sm:text-xl"
            inputMode="numeric"
            value={groupDigits(form.amountSoum)}
            onChange={(e) => setForm((f) => ({ ...f, amountSoum: e.target.value }))}
            required
            placeholder="100 000"
          />
        </Field>

        <Field label={uz.deal.commissionPayer}>
          <div className="grid gap-2 sm:grid-cols-3">
            {PAYER_OPTIONS.map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => setForm((f) => ({ ...f, commissionPayer: opt.id }))}
                className={form.commissionPayer === opt.id ? 'choice-on' : 'choice-off'}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </Field>

        {/* Serverdan kelgan hisob-kitob — har bir tiyin ko'rsatiladi */}
        {preview && (
          <div className="rounded-lg bg-slate-50 p-4">
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between">
                <dt className="font-medium text-slate-900">{uz.deal.buyerPays}</dt>
                <dd className="tabular font-semibold text-slate-900">
                  {formatAmount(preview.buyerPaysTiyin)}
                </dd>
              </div>

              <div className="space-y-1.5 border-y border-slate-200 py-2 pl-3 text-xs">
                <div className="flex justify-between">
                  <dt className="text-slate-500">
                    Bank/karta komissiyasi ({(COMMISSION_POLICY.providerFeeBps / 100).toFixed(1)}%)
                  </dt>
                  <dd className="tabular text-slate-500">
                    {formatAmount(preview.providerFeeTiyin)}
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-slate-500">
                    Xizmat haqqi ({(COMMISSION_POLICY.rateBps / 100).toFixed(0)}%)
                  </dt>
                  <dd className="tabular text-slate-500">
                    {formatAmount(preview.commissionTiyin)}
                  </dd>
                </div>
              </div>

              <div className="flex justify-between">
                <dt className="font-medium text-slate-900">{uz.deal.sellerReceives}</dt>
                <dd className="tabular font-semibold text-slate-900">
                  {formatAmount(preview.sellerReceivesTiyin)}
                </dd>
              </div>
            </dl>
          </div>
        )}

        {/* Muddatlar — savdo yaratishdan oldin bilinsin */}
        <p className="rounded-lg bg-slate-50 px-4 py-3 text-xs leading-relaxed text-slate-600">
          Xaridor to&apos;lagach pul platformada muzlatib turiladi.{' '}
          {form.dealType === 'DIGITAL'
            ? `Mahsulotni topshirasiz, xaridorda tekshirish uchun ${typeRule.autoReleaseHours} soat bo'ladi.`
            : form.dealType === 'GAME_ACCOUNT'
              ? `Chat ochiladi, akkauntni o'sha yerda o'tkazasiz. Xaridorda tekshirish uchun ${typeRule.autoReleaseHours / 24} kun bo'ladi.`
              : `Tovarni yuborasiz, xaridorda tasdiqlash uchun ${typeRule.autoReleaseHours / 24} kun bo'ladi.`}{' '}
          Tasdiqlangach pul sizga o&apos;tadi va{' '}
          <strong>30 soatdan keyin yechib olish mumkin bo&apos;ladi</strong>.
        </p>

        <button
          type="submit"
          className="btn-primary w-full py-3"
          disabled={busy || !amountValid || !keywordValid}
        >
          {busy ? uz.common.loading : uz.deal.createButton}
        </button>
      </form>
    </div>
  );
}

'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { COMMISSION_POLICY, uz } from '@escrowuz/shared';
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

export default function NewDealPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useRequireAuth();

  const [form, setForm] = useState({
    title: '',
    description: '',
    /** Foydalanuvchi SO'MDA kiritadi — tiyin ichki birlik. */
    amountSoum: '',
    commissionPayer: 'seller' as Payer,
    counterpartyEmail: '',
    myRole: 'seller' as 'buyer' | 'seller',
  });
  const [preview, setPreview] = useState<{
    buyerPaysTiyin: string;
    sellerReceivesTiyin: string;
    commissionTiyin: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const amountTiyin = soumToTiyin(form.amountSoum);
  const amountValid = BigInt(amountTiyin) >= BigInt(COMMISSION_POLICY.minDealAmountTiyin);

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
        counterpartyEmail: form.counterpartyEmail,
        myRole: form.myRole,
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

      <form onSubmit={onSubmit} className="card mt-6 space-y-5 p-6">
        <ErrorBox message={error} />

        {/* Rol tanlash */}
        <Field label="Bu savdoda siz kimsiz?">
          <div className="grid grid-cols-2 gap-2">
            {(['seller', 'buyer'] as const).map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setForm((f) => ({ ...f, myRole: r }))}
                className={`rounded-lg border px-4 py-3 text-sm transition-colors ${
                  form.myRole === r
                    ? 'border-brand-500 bg-brand-50 font-medium text-brand-800'
                    : 'border-slate-300 bg-white text-slate-600 hover:bg-slate-50'
                }`}
              >
                {r === 'seller' ? uz.deal.myRoleSeller : uz.deal.myRoleBuyer}
              </button>
            ))}
          </div>
        </Field>

        <Field label={uz.deal.itemTitle}>
          <input
            className="input"
            value={form.title}
            onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
            required
            minLength={3}
            maxLength={200}
            placeholder="Masalan: iPhone 14 Pro, 256GB"
          />
        </Field>

        <Field label={uz.deal.description}>
          <textarea
            className="input min-h-24"
            value={form.description}
            onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
            maxLength={5000}
            placeholder="Holati, kafolat, yetkazib berish shartlari…"
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
            className="input tabular text-lg"
            inputMode="numeric"
            value={groupDigits(form.amountSoum)}
            onChange={(e) => setForm((f) => ({ ...f, amountSoum: e.target.value }))}
            required
            placeholder="100 000"
          />
        </Field>

        <Field label={uz.deal.commissionPayer}>
          <div className="grid grid-cols-3 gap-2">
            {PAYER_OPTIONS.map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => setForm((f) => ({ ...f, commissionPayer: opt.id }))}
                className={`rounded-lg border px-3 py-2.5 text-sm transition-colors ${
                  form.commissionPayer === opt.id
                    ? 'border-brand-500 bg-brand-50 font-medium text-brand-800'
                    : 'border-slate-300 bg-white text-slate-600 hover:bg-slate-50'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </Field>

        {/* Serverdan kelgan hisob-kitob */}
        {preview && (
          <div className="rounded-lg bg-slate-50 p-4">
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between">
                <dt className="text-slate-600">{uz.deal.buyerPays}</dt>
                <dd className="tabular font-semibold text-slate-900">
                  {formatAmount(preview.buyerPaysTiyin)}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-slate-600">{uz.deal.sellerReceives}</dt>
                <dd className="tabular font-semibold text-slate-900">
                  {formatAmount(preview.sellerReceivesTiyin)}
                </dd>
              </div>
              <div className="flex justify-between border-t border-slate-200 pt-2 text-xs">
                <dt className="text-slate-500">{uz.deal.commission}</dt>
                <dd className="tabular text-slate-500">
                  {formatAmount(preview.commissionTiyin)}
                </dd>
              </div>
            </dl>
          </div>
        )}

        <Field label={uz.deal.counterparty} hint={uz.deal.createHint}>
          <input
            type="email"
            className="input"
            value={form.counterpartyEmail}
            onChange={(e) => setForm((f) => ({ ...f, counterpartyEmail: e.target.value }))}
            required
            placeholder="hamkor@example.com"
          />
        </Field>

        <button
          type="submit"
          className="btn-primary w-full py-3"
          disabled={busy || !amountValid}
        >
          {busy ? uz.common.loading : uz.deal.createButton}
        </button>
      </form>
    </div>
  );
}

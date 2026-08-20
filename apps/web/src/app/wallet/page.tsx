'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { uz } from '@escrowuz/shared';
import { useRequireAuth } from '@/components/AuthProvider';
import { ErrorBox, Field, Spinner, useCountdown } from '@/components/ui';
import { api, ApiRequestError, type Transaction, type Wallet } from '@/lib/api';
import { formatAmount, formatDate, groupDigits, soumToTiyin } from '@/lib/format';

export default function WalletPage() {
  const { user, loading: authLoading } = useRequireAuth();
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [w, t] = await Promise.all([api.wallet.get(), api.wallet.transactions()]);
      setWallet(w);
      setTransactions(t.transactions);
      setError(null);
    } catch {
      setError('Hamyonni yuklab bo\'lmadi');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (user) void load();
  }, [user, load]);

  if (authLoading || loading) return <Spinner />;
  if (!user || !wallet) return <ErrorBox message={error ?? uz.common.error} />;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold text-slate-900">{uz.wallet.title}</h1>

      <ErrorBox message={error} />

      {/* ── Balans ───────────────────────────────────────────────────────── */}
      {/*
        Uchta alohida summa. Ularni birlashtirsak foydalanuvchi "pulim bor,
        nega yecholmayapman?" degan savol bilan qolardi.
      */}
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="card p-4 sm:p-5">
          <p className="text-sm text-slate-500">{uz.wallet.available}</p>
          <p className="tabular mt-1 text-2xl font-semibold text-emerald-700">
            {formatAmount(wallet.availableTiyin)}
          </p>
        </div>

        <div className="card p-4 sm:p-5">
          <p className="text-sm text-slate-500">{uz.wallet.holding}</p>
          <p className="tabular mt-1 text-2xl font-semibold text-amber-600">
            {formatAmount(wallet.holdingTiyin)}
          </p>
          <p className="mt-2 text-xs text-slate-500">{uz.wallet.holdingHint}</p>
          <HoldCountdown releaseAt={wallet.nextReleaseAt} />
        </div>

        <div className="card p-4 sm:p-5">
          <p className="text-sm text-slate-500">{uz.wallet.pending}</p>
          <p className="tabular mt-1 text-2xl font-semibold text-slate-400">
            {formatAmount(wallet.pendingTiyin)}
          </p>
          <p className="mt-2 text-xs text-slate-500">{uz.wallet.pendingHint}</p>
        </div>
      </div>

      {/* ── Pul yechish ──────────────────────────────────────────────────── */}
      <PayoutForm availableTiyin={wallet.availableTiyin} onDone={load} />

      {/* ── Tranzaksiyalar ───────────────────────────────────────────────── */}
      <section className="card overflow-hidden">
        <h2 className="border-b border-slate-100 px-4 py-4 font-semibold text-slate-900 sm:px-6">
          {uz.wallet.transactions}
        </h2>

        {transactions.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-slate-500 sm:px-6">
            {uz.wallet.noTransactions}
          </p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {transactions.map((tx) => {
              const amount = BigInt(tx.amount);
              const isPending = tx.accountId.endsWith(':pending');
              const isHolding = tx.accountId.endsWith(':holding');
              return (
                <li key={tx.id} className="flex items-center gap-3 px-4 py-4 sm:gap-4 sm:px-6">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm text-slate-900">
                      {tx.deal ? (
                        <Link href={`/deals/${tx.deal.id}`} className="hover:underline">
                          {tx.deal.title}
                        </Link>
                      ) : (
                        entryTypeLabel(tx.entryType)
                      )}
                    </p>
                    <p className="mt-0.5 text-xs text-slate-500">
                      {formatDate(tx.createdAt)}
                      {isPending && ` · ${uz.wallet.pending.toLowerCase()}`}
                      {isHolding && ` · ${uz.wallet.holding.toLowerCase()}`}
                    </p>
                  </div>
                  <span
                    className={`tabular shrink-0 text-sm font-medium ${
                      amount >= 0n ? 'text-emerald-700' : 'text-slate-600'
                    }`}
                  >
                    {amount >= 0n ? '+' : ''}
                    {formatAmount(tx.amount)}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}

/**
 * Muzlatilgan pul qachon ochilishini ko'rsatadi.
 *
 * Aniq sana emas, QOLGAN VAQT ko'rsatiladi: "18 soat qoldi" ni tushunish
 * "19-avgust 14:32 da ochiladi" dan osonroq.
 */
function HoldCountdown({ releaseAt }: { releaseAt: string | null }) {
  const remaining = useCountdown(releaseAt);
  if (!releaseAt) return null;

  if (remaining <= 0) {
    return (
      <p className="mt-2 text-xs font-medium text-emerald-700">
        Ochilmoqda — bir necha daqiqada hisobingizga o&apos;tadi
      </p>
    );
  }

  const hours = Math.floor(remaining / 3_600_000);
  const minutes = Math.floor((remaining % 3_600_000) / 60_000);

  return (
    <p className="mt-2 text-xs font-medium text-amber-700">
      {uz.wallet.holdingReleaseIn}: {hours > 0 ? `${hours} soat ` : ''}
      {minutes} daqiqa
    </p>
  );
}

function entryTypeLabel(type: string): string {
  const labels: Record<string, string> = {
    deposit: 'To\'lov qabul qilindi',
    release: 'Savdo yakunlandi',
    refund: 'Pul qaytarildi',
    commission: 'Komissiya',
    payout: 'Pul yechildi',
    payout_reversal: 'Yechish bekor qilindi',
    adjustment: 'Tuzatish',
  };
  return labels[type] ?? type;
}

function PayoutForm({
  availableTiyin,
  onDone,
}: {
  availableTiyin: string;
  onDone: () => Promise<void>;
}) {
  const [amountSoum, setAmountSoum] = useState('');
  const [destination, setDestination] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const available = BigInt(availableTiyin);
  const requested = BigInt(soumToTiyin(amountSoum));
  const tooMuch = requested > available;

  if (available <= 0n) return null;

  return (
    <section className="card p-4 sm:p-6">
      <h2 className="font-semibold text-slate-900">{uz.wallet.payout}</h2>

      <form
        className="mt-4 space-y-4"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError(null);
          setSuccess(false);
          try {
            await api.wallet.payout(soumToTiyin(amountSoum), destination);
            setSuccess(true);
            setAmountSoum('');
            setDestination('');
            await onDone();
          } catch (err) {
            setError(err instanceof ApiRequestError ? err.message : uz.common.error);
          } finally {
            setBusy(false);
          }
        }}
      >
        <ErrorBox message={error} />
        {success && (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
            Yechish so&apos;rovi qabul qilindi.
          </div>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label={`${uz.wallet.payoutAmount} (${uz.common.soum})`}
            {...(tooMuch ? { error: uz.wallet.insufficientFunds } : {})}
          >
            <input
              className="input tabular"
              inputMode="numeric"
              value={groupDigits(amountSoum)}
              onChange={(e) => setAmountSoum(e.target.value)}
              required
              placeholder="50 000"
            />
          </Field>

          <Field label={uz.wallet.payoutDestination}>
            <input
              className="input tabular"
              inputMode="numeric"
              value={destination}
              onChange={(e) => setDestination(e.target.value)}
              required
              minLength={4}
              placeholder="8600 1234 5678 9012"
            />
          </Field>
        </div>

        <button
          type="submit"
          className="btn-primary w-full sm:w-auto"
          disabled={busy || tooMuch || requested <= 0n}
        >
          {busy ? uz.common.loading : uz.wallet.payoutButton}
        </button>
      </form>
    </section>
  );
}

'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { isTerminal, uz, type DealStatus } from '@escrowuz/shared';
import { useRequireAuth } from '@/components/AuthProvider';
import { EmptyState, ErrorBox, Spinner, StatusBadge } from '@/components/ui';
import { HowItWorks } from '@/components/HowItWorks';
import { api, type Deal, type User } from '@/lib/api';
import { formatAmount, formatDateShort } from '@/lib/format';

type Tab = 'active' | 'completed' | 'disputed';

const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'active', label: uz.deal.tabActive },
  { id: 'completed', label: uz.deal.tabCompleted },
  { id: 'disputed', label: uz.deal.tabDisputed },
];

/**
 * Foydalanuvchi ma'lumotlari.
 *
 * Email savdo uchun KERAK EMAS (savdo kalit so'z orqali topiladi), lekin
 * ko'rinib turishi kerak: xabarnomalar shu manzilga boradi va foydalanuvchi
 * qaysi hisob bilan kirganini bilishi kerak.
 */
function ProfileCard({ user }: { user: User }) {
  const [copied, setCopied] = useState(false);

  async function copyEmail() {
    try {
      await navigator.clipboard.writeText(user.email);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API HTTPS talab qiladi. Ishlamasa foydalanuvchi qo'lda
      // belgilab oladi — email ekranda ko'rinib turibdi.
    }
  }

  return (
    <section className="card mt-6 p-4 sm:p-5">
      <div className="flex items-center gap-3 sm:gap-4">
        {/* Ism bosh harfi — avatar o'rniga */}
        <span
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-brand-50 text-lg font-semibold text-brand-700"
          aria-hidden
        >
          {user.fullName.trim().charAt(0).toUpperCase() || '?'}
        </span>

        <div className="min-w-0 flex-1">
          <p className="truncate font-medium text-slate-900">
            {user.fullName}
            {user.role === 'admin' && (
              <span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-normal text-slate-600">
                admin
              </span>
            )}
          </p>
          <p className="break-anywhere mt-0.5 text-sm text-slate-500">{user.email}</p>
          {user.phone && <p className="mt-0.5 text-sm text-slate-500">{user.phone}</p>}
        </div>

        <button
          type="button"
          onClick={() => void copyEmail()}
          className="btn-secondary shrink-0 py-2 text-xs"
        >
          {copied ? uz.common.copied : uz.common.copy}
        </button>
      </div>

      <p className="mt-3 border-t border-slate-100 pt-3 text-xs leading-relaxed text-slate-500">
        Savdo haqidagi barcha xabarnomalar shu manzilga yuboriladi.
        Sotish uchun kalit so&apos;z yaratasiz, sotib olish uchun sotuvchining
        kalit so&apos;zini kiritasiz — email almashish kerak emas.
      </p>
    </section>
  );
}

function belongsTo(tab: Tab, status: DealStatus): boolean {
  if (tab === 'disputed') return status === 'DISPUTED' || status === 'PAYMENT_MISMATCH';
  if (tab === 'completed') return isTerminal(status);
  return !isTerminal(status) && status !== 'DISPUTED' && status !== 'PAYMENT_MISMATCH';
}

export default function DashboardPage() {
  const { user, loading: authLoading } = useRequireAuth();
  const [deals, setDeals] = useState<Deal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('active');

  const load = useCallback(async () => {
    try {
      const { deals: list } = await api.deals.list();
      setDeals(list);
      setError(null);
    } catch {
      setError('Savdolarni yuklab bo\'lmadi');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (user) void load();
  }, [user, load]);

  const filtered = useMemo(() => deals.filter((d) => belongsTo(tab, d.status)), [deals, tab]);

  const counts = useMemo(
    () => ({
      active: deals.filter((d) => belongsTo('active', d.status)).length,
      completed: deals.filter((d) => belongsTo('completed', d.status)).length,
      disputed: deals.filter((d) => belongsTo('disputed', d.status)).length,
    }),
    [deals],
  );

  if (authLoading || loading) return <Spinner />;
  if (!user) return null;

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold text-slate-900">{uz.nav.dashboard}</h1>
        <div className="flex gap-2">
          <Link href="/deals/find" className="btn-secondary">
            Sotib olish
          </Link>
          <Link href="/deals/new" className="btn-primary">
            + Sotish
          </Link>
        </div>
      </div>

      <ErrorBox message={error} />

      {/* ── Profil ────────────────────────────────────────────────────────
          Email ko'rinib turishi kerak: savdo yaratganda qarshi tomon aynan
          shu manzilni kiritadi. Foydalanuvchi uni qidirib yurmasin. */}
      <ProfileCard user={user} />

      {/* Yangi foydalanuvchilar uchun qisqa tushuntirish */}
      <div className="mt-6">
        <HowItWorks />
      </div>

      {/* Tablar */}
      <div
        className="-mx-4 mt-6 flex gap-1 overflow-x-auto border-b border-slate-200 px-4 sm:mx-0 sm:px-0"
        role="tablist"
      >
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={`-mb-px shrink-0 whitespace-nowrap border-b-2 px-4 py-3 text-sm transition-colors ${
              tab === t.id
                ? 'border-brand-600 font-medium text-brand-700'
                : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            {t.label}
            <span className="ml-1.5 text-xs text-slate-400">{counts[t.id]}</span>
          </button>
        ))}
      </div>

      {/* Ro'yxat */}
      <div className="mt-6">
        {filtered.length === 0 ? (
          <EmptyState
            title={uz.deal.noDeals}
            text={uz.deal.noDealsHint}
            actionHref="/deals/find"
            actionLabel="Kalit so'z bilan sotib olish"
          />
        ) : (
          <ul className="space-y-3">
            {filtered.map((deal) => {
              const isBuyer = deal.buyerId === user.id;
              return (
                <li key={deal.id}>
                  <Link
                    href={`/deals/${deal.id}`}
                    className="card flex items-center gap-3 p-4 transition-shadow hover:shadow-md sm:gap-4"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="truncate font-medium text-slate-900">{deal.title}</span>
                        <StatusBadge status={deal.status} dealType={deal.dealType} />
                      </div>
                      <p className="mt-1 text-sm text-slate-500">
                        {isBuyer ? uz.deal.myRoleBuyer : uz.deal.myRoleSeller} ·{' '}
                        {deal.game ? `${deal.game} · ` : ''}
                        {formatDateShort(deal.createdAt)}
                      </p>
                      {/*
                        Band qilinmagan savdoda kalit so'z ko'rsatiladi —
                        sotuvchi uni xaridorga yuborishi kerak, va uni
                        qidirib yurmasin.
                      */}
                      {!deal.claimedAt && deal.sellerId === user.id && (
                        <p className="mt-1 text-xs text-slate-500">
                          Kalit so&apos;z:{' '}
                          <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-slate-900">
                            {deal.keyword}
                          </span>
                        </p>
                      )}
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="tabular font-semibold text-slate-900">
                        {formatAmount(deal.amountTiyin)}
                      </p>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

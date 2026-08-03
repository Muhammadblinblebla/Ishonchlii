'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { isTerminal, uz, type DealStatus } from '@escrowuz/shared';
import { useRequireAuth } from '@/components/AuthProvider';
import { EmptyState, ErrorBox, Spinner, StatusBadge } from '@/components/ui';
import { HowItWorks } from '@/components/HowItWorks';
import { api, type Deal } from '@/lib/api';
import { formatAmount, formatDateShort } from '@/lib/format';

type Tab = 'active' | 'completed' | 'disputed';

const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'active', label: uz.deal.tabActive },
  { id: 'completed', label: uz.deal.tabCompleted },
  { id: 'disputed', label: uz.deal.tabDisputed },
];

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
        <Link href="/deals/new" className="btn-primary">
          + {uz.nav.newDeal}
        </Link>
      </div>

      <ErrorBox message={error} />

      {/* Yangi foydalanuvchilar uchun qisqa tushuntirish */}
      <div className="mt-6">
        <HowItWorks />
      </div>

      {/* Tablar */}
      <div className="mt-6 flex gap-1 border-b border-slate-200" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={`-mb-px border-b-2 px-4 py-2.5 text-sm transition-colors ${
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
            actionHref="/deals/new"
            actionLabel={uz.nav.newDeal}
          />
        ) : (
          <ul className="space-y-3">
            {filtered.map((deal) => {
              const isBuyer = deal.buyerId === user.id;
              return (
                <li key={deal.id}>
                  <Link
                    href={`/deals/${deal.id}`}
                    className="card flex items-center gap-4 p-4 transition-shadow hover:shadow-md"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="truncate font-medium text-slate-900">{deal.title}</span>
                        <StatusBadge status={deal.status} />
                      </div>
                      <p className="mt-1 text-sm text-slate-500">
                        {isBuyer ? uz.deal.myRoleBuyer : uz.deal.myRoleSeller} ·{' '}
                        {formatDateShort(deal.createdAt)}
                      </p>
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

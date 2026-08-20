'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { supportStatusLabels } from '@escrowuz/shared';
import { useRequireAuth } from '@/components/AuthProvider';
import { EmptyState, ErrorBox, Spinner } from '@/components/ui';
import { api, type AdminSupportTicketRow } from '@/lib/api';
import { formatDateShort } from '@/lib/format';

type Filter = 'open' | 'answered' | 'closed' | 'all';

const FILTERS: Array<{ id: Filter; label: string }> = [
  { id: 'open', label: 'Javob kutmoqda' },
  { id: 'answered', label: 'Javob berilgan' },
  { id: 'closed', label: 'Yopilgan' },
  { id: 'all', label: 'Hammasi' },
];

/** Necha soatdan beri javob kutmoqda. */
function waitingHours(iso: string): number {
  return Math.floor((Date.now() - new Date(iso).getTime()) / 3_600_000);
}

export default function AdminSupportPage() {
  const { user, loading: authLoading } = useRequireAuth();
  const [tickets, setTickets] = useState<AdminSupportTicketRow[]>([]);
  const [filter, setFilter] = useState<Filter>('open');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { tickets: list } = await api.admin.supportTickets(filter);
      setTickets(list);
      setError(null);
    } catch {
      setError('Yuklab bo\'lmadi');
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    if (user) void load();
  }, [user, load]);

  if (authLoading) return <Spinner />;
  if (!user) return null;
  if (user.role !== 'admin') {
    return <ErrorBox message="Bu sahifa faqat administrator uchun" />;
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold text-slate-900">Murojaatlar</h1>

      <div className="-mx-4 flex gap-1 overflow-x-auto border-b border-slate-200 px-4 sm:mx-0 sm:px-0">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            onClick={() => setFilter(f.id)}
            className={`-mb-px shrink-0 whitespace-nowrap border-b-2 px-4 py-3 text-sm transition-colors ${
              filter === f.id
                ? 'border-brand-600 font-medium text-brand-700'
                : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      <ErrorBox message={error} />

      {loading ? (
        <Spinner />
      ) : tickets.length === 0 ? (
        <EmptyState title="Bo'sh" text="Bu bo'limda murojaat yo'q." />
      ) : (
        <ul className="space-y-3">
          {tickets.map((t) => {
            const hours = waitingHours(t.lastMessageAt);
            // 24 soatdan ko'p kutgan murojaat ajratib ko'rsatiladi
            const stale = t.status === 'open' && hours >= 24;
            return (
              <li key={t.id}>
                <Link
                  href={`/admin/support/${t.id}`}
                  className={`card flex items-center gap-3 p-4 transition-shadow hover:shadow-md ${
                    stale ? 'border-red-200 bg-red-50' : ''
                  }`}
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium text-slate-900">{t.subject}</p>
                    <p className="mt-1 truncate text-sm text-slate-500">
                      {t.user.fullName} · {t.user.email}
                    </p>
                    <p className="mt-0.5 text-xs text-slate-400">
                      {t._count.messages} ta xabar · {formatDateShort(t.lastMessageAt)}
                      {t.status === 'open' && ` · ${hours} soatdan beri kutmoqda`}
                    </p>
                  </div>
                  <span className="shrink-0 text-xs text-slate-500">
                    {supportStatusLabels[t.status]}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

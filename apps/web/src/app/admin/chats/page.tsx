'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { statusLabels } from '@escrowuz/shared';
import { useRequireAuth } from '@/components/AuthProvider';
import { EmptyState, ErrorBox, Spinner } from '@/components/ui';
import { api, type AdminChatRow } from '@/lib/api';
import { formatAmount, formatDateShort } from '@/lib/format';

export default function AdminChatsPage() {
  const { user, loading: authLoading } = useRequireAuth();
  const [deals, setDeals] = useState<AdminChatRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const { deals: list } = await api.admin.chats();
      setDeals(list);
      setError(null);
    } catch {
      setError('Yuklab bo\'lmadi');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (user) void load();
  }, [user, load]);

  if (authLoading || loading) return <Spinner />;
  if (!user || user.role !== 'admin') return <ErrorBox message="Ruxsat yo'q" />;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Yozishmalar</h1>
        <p className="mt-2 text-sm text-slate-600">
          Savdolardagi chatlar. Yozishmani ochganingiz savdo tarixiga yoziladi va
          ikkala tomon buni ko&apos;radi.
        </p>
      </div>

      <ErrorBox message={error} />

      {deals.length === 0 ? (
        <EmptyState title="Yozishma yo'q" text="Hali hech kim chatda yozmagan." />
      ) : (
        <ul className="space-y-3">
          {deals.map((d) => (
            <li key={d.id}>
              <Link
                href={`/admin/chats/${d.id}`}
                className="card flex items-center gap-3 p-4 transition-shadow hover:shadow-md"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-slate-900">{d.title}</p>
                  <p className="mt-1 truncate text-sm text-slate-500">
                    {d.seller.fullName} → {d.buyer?.fullName ?? 'xaridor yo\'q'}
                  </p>
                  <p className="mt-0.5 text-xs text-slate-400">
                    {statusLabels[d.status]} · {d._count.messages} ta xabar ·{' '}
                    {formatDateShort(d.updatedAt)}
                  </p>
                </div>
                <span className="tabular shrink-0 text-sm font-medium text-slate-900">
                  {formatAmount(d.amountTiyin)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

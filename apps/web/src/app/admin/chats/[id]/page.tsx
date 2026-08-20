'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { statusLabels } from '@escrowuz/shared';
import { useRequireAuth } from '@/components/AuthProvider';
import { ErrorBox, Spinner } from '@/components/ui';
import { api, type AdminChatDetail } from '@/lib/api';
import { formatDate } from '@/lib/format';

export default function AdminChatPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { user, loading: authLoading } = useRequireAuth();

  const [data, setData] = useState<AdminChatDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    void api.admin
      .chat(id)
      .then(setData)
      .catch(() => setError('Yuklab bo\'lmadi'))
      .finally(() => setLoading(false));
  }, [user, id]);

  if (authLoading || loading) return <Spinner />;
  if (!user || user.role !== 'admin') return <ErrorBox message="Ruxsat yo'q" />;
  if (!data) return <ErrorBox message={error ?? 'Topilmadi'} />;

  return (
    <div className="space-y-6">
      <button
        onClick={() => router.push('/admin/chats')}
        className="text-sm text-slate-500 hover:text-slate-700"
      >
        ← Yozishmalar
      </button>

      <div>
        <h1 className="break-anywhere text-xl font-semibold text-slate-900 sm:text-2xl">
          {data.deal.title}
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          {statusLabels[data.deal.status]} ·{' '}
          <Link href={`/deals/${data.deal.id}`} className="text-brand-700 hover:underline">
            savdoni ochish
          </Link>
        </p>
      </div>

      {/* Bu ogohlantirish ataylab ko'rinarli: chatdan akkaunt paroli o'tadi */}
      <p className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
        ⚠️ Bu yozishmalarda akkaunt parollari bo&apos;lishi mumkin. Siz ochganingiz
        savdo tarixiga yozildi — sotuvchi ham, xaridor ham buni ko&apos;radi.
      </p>

      <section className="space-y-3">
        {data.messages.length === 0 ? (
          <p className="text-sm text-slate-500">Xabar yo&apos;q.</p>
        ) : (
          data.messages.map((m) => (
            <div
              key={m.id}
              className={`card p-4 ${m.fromBuyer ? '' : 'border-brand-200 bg-brand-50'}`}
            >
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-sm font-medium text-slate-900">
                  {m.fromBuyer
                    ? `${data.deal.buyer?.fullName ?? 'Xaridor'} (xaridor)`
                    : `${data.deal.seller.fullName} (sotuvchi)`}
                </span>
                <span className="shrink-0 text-xs text-slate-400">
                  {formatDate(m.createdAt)}
                  {m.readAt ? ' · o\'qilgan' : ' · o\'qilmagan'}
                </span>
              </div>
              <p className="break-anywhere mt-2 whitespace-pre-wrap font-mono text-sm text-slate-800">
                {m.body}
              </p>
            </div>
          ))
        )}
      </section>
    </div>
  );
}

'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useRequireAuth } from '@/components/AuthProvider';
import { ErrorBox, Spinner } from '@/components/ui';
import { api } from '@/lib/api';
import { formatAmount } from '@/lib/format';

interface Stats {
  openDisputes: number;
  paymentMismatches: number;
  activeDeals: number;
  escrowTiyin: string;
  pendingPayoutCount: number;
  pendingPayoutTiyin: string;
  shortfallTiyin: string | null;
  openTickets?: number;
}

/**
 * Admin bosh sahifasi.
 *
 * Nizolar va to'lov nomuvofiqliklari endi AVTOMATIK hal qilinadi
 * (`dispute-policy.ts`). Bu yerdagi raqamlar — kuzatuv uchun: agar
 * ular o'sib borsa, avtomatika ishlamayapti degani.
 *
 * Qo'lda ish TALAB QILADIGAN yagona narsa — pul chiqarish navbati
 * (Click SHOP API payout'ni qo'llab-quvvatlamaydi) va murojaatlar.
 */
export default function AdminHome() {
  const { user, loading: authLoading } = useRequireAuth();
  const [stats, setStats] = useState<Stats | null>(null);
  const [tickets, setTickets] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user || user.role !== 'admin') return;
    void Promise.all([
      api.admin.stats().catch(() => null),
      api.admin.supportTickets('open').then((r) => r.tickets.length).catch(() => null),
    ]).then(([s, t]) => {
      if (s) setStats(s as Stats);
      else setError('Statistikani yuklab bo\'lmadi');
      setTickets(t);
    });
  }, [user]);

  if (authLoading) return <Spinner />;
  if (!user) return null;
  if (user.role !== 'admin') return <ErrorBox message="Bu sahifa faqat administrator uchun" />;

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-semibold text-slate-900">Boshqaruv paneli</h1>

      <ErrorBox message={error} />

      {/* ── Ish talab qiladigan narsalar ─────────────────────────────────── */}
      <section>
        <h2 className="text-sm font-medium uppercase tracking-wide text-slate-500">
          Sizdan ish kutmoqda
        </h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <Card
            href="/admin/support"
            title="Murojaatlar"
            value={tickets === null ? '—' : String(tickets)}
            hint="Foydalanuvchilar savollari"
            urgent={(tickets ?? 0) > 0}
          />
          <Card
            href="/admin/payouts"
            title="Pul chiqarish"
            value={stats ? String(stats.pendingPayoutCount) : '—'}
            hint={stats ? formatAmount(stats.pendingPayoutTiyin) : 'bank o\'tkazmasi kerak'}
            urgent={(stats?.pendingPayoutCount ?? 0) > 0}
          />
        </div>
      </section>

      {/* ── Avtomatika kuzatuvi ──────────────────────────────────────────── */}
      <section>
        <h2 className="text-sm font-medium uppercase tracking-wide text-slate-500">
          Avtomatik hal qilinadi
        </h2>
        <p className="mt-1 text-xs text-slate-500">
          Bu raqamlar uzoq vaqt o&apos;sib borsa — avtomatika ishlamayapti.
        </p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <Card
            href="/admin/disputes"
            title="Ochiq nizolar"
            value={stats ? String(stats.openDisputes) : '—'}
            hint="24 soatdan keyin tizim o'zi hal qiladi"
          />
          <Card
            href="/admin/disputes"
            title="To'lov nomuvofiqligi"
            value={stats ? String(stats.paymentMismatches) : '—'}
            hint="Avtomatik qaytariladi"
          />
        </div>
      </section>

      {/* ── Pul holati ───────────────────────────────────────────────────── */}
      <section>
        <h2 className="text-sm font-medium uppercase tracking-wide text-slate-500">Pul</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <Card
            title="Escrowda"
            value={stats ? formatAmount(stats.escrowTiyin) : '—'}
            hint={`${stats?.activeDeals ?? 0} ta faol savdo`}
          />
          {stats?.shortfallTiyin && BigInt(stats.shortfallTiyin) > 0n && (
            <Card
              title="⚠️ Yetishmovchilik"
              value={formatAmount(stats.shortfallTiyin)}
              hint="Provayder balansi escrowdan kam!"
              urgent
            />
          )}
        </div>
      </section>

      {/* ── Kuzatuv ──────────────────────────────────────────────────────── */}
      <section>
        <h2 className="text-sm font-medium uppercase tracking-wide text-slate-500">Kuzatuv</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <Card href="/admin/chats" title="Yozishmalar" value="→" hint="Savdolardagi chatlar" />
          <Card href="/admin/disputes" title="Nizolar tarixi" value="→" hint="Barcha qarorlar" />
        </div>
      </section>
    </div>
  );
}

function Card({
  href,
  title,
  value,
  hint,
  urgent,
}: {
  href?: string;
  title: string;
  value: string;
  hint: string;
  urgent?: boolean;
}) {
  const inner = (
    <div
      className={`card h-full p-4 ${urgent ? 'border-amber-300 bg-amber-50' : ''} ${
        href ? 'transition-shadow hover:shadow-md' : ''
      }`}
    >
      <p className="text-sm text-slate-600">{title}</p>
      <p className="tabular mt-1 text-2xl font-semibold text-slate-900">{value}</p>
      <p className="mt-1 text-xs text-slate-500">{hint}</p>
    </div>
  );
  return href ? <Link href={href}>{inner}</Link> : inner;
}

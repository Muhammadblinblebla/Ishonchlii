'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { statusLabels, uz } from '@escrowuz/shared';
import { useRequireAuth } from '@/components/AuthProvider';
import { ErrorBox, Spinner } from '@/components/ui';
import { AuthImage } from '@/components/AuthImage';
import { api, ApiRequestError, type AdminSupportTicketDetail } from '@/lib/api';
import { formatAmount, formatDate } from '@/lib/format';

export default function AdminTicketPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { user, loading: authLoading } = useRequireAuth();

  const [ticket, setTicket] = useState<AdminSupportTicketDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const { ticket: t } = await api.admin.supportTicket(id);
      setTicket(t);
      setError(null);
    } catch {
      setError('Yuklab bo\'lmadi');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    if (user) void load();
  }, [user, load]);

  if (authLoading || loading) return <Spinner />;
  if (!user || user.role !== 'admin') return <ErrorBox message="Ruxsat yo'q" />;
  if (!ticket) return <ErrorBox message={error ?? 'Topilmadi'} />;

  async function act(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      setBody('');
      await load();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : uz.common.error);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <button
        onClick={() => router.push('/admin/support')}
        className="text-sm text-slate-500 hover:text-slate-700"
      >
        ← Murojaatlar
      </button>

      <h1 className="break-anywhere text-xl font-semibold text-slate-900 sm:text-2xl">
        {ticket.subject}
      </h1>

      <ErrorBox message={error} />

      {/* Kim yozgani — admin darhol kontekstni ko'rsin */}
      <section className="card p-4 sm:p-6">
        <h2 className="font-semibold text-slate-900">Kim yozdi</h2>
        <dl className="mt-3 space-y-2 text-sm">
          <Row label="Ism" value={ticket.user.fullName} />
          <Row label="Email" value={ticket.user.email} />
          {ticket.user.phone && <Row label="Telefon" value={ticket.user.phone} />}
          <Row label="Ro'yxatdan o'tgan" value={formatDate(ticket.user.createdAt)} />
        </dl>

        {ticket.deal && (
          <div className="mt-4 rounded-lg bg-slate-50 p-3">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
              Bog&apos;liq savdo
            </p>
            <Link
              href={`/deals/${ticket.deal.id}`}
              className="mt-1 block font-medium text-brand-700 hover:underline"
            >
              {ticket.deal.title}
            </Link>
            <p className="mt-1 text-sm text-slate-600">
              {statusLabels[ticket.deal.status]} · {formatAmount(ticket.deal.amountTiyin)} ·
              kalit so&apos;z: <code className="font-mono">{ticket.deal.keyword}</code>
            </p>
          </div>
        )}
      </section>

      <section className="space-y-3">
        {ticket.messages.map((m) => (
          <div
            key={m.id}
            className={`card p-4 ${m.fromAdmin ? 'border-brand-200 bg-brand-50' : ''}`}
          >
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-sm font-medium text-slate-900">
                {m.fromAdmin ? 'Siz (admin)' : ticket.user.fullName}
              </span>
              <span className="shrink-0 text-xs text-slate-400">{formatDate(m.createdAt)}</span>
            </div>
            <p className="break-anywhere mt-2 whitespace-pre-wrap text-sm text-slate-800">
              {m.body}
            </p>
            {m.attachment && (
              <div className="mt-3">
                <AuthImage
                  url={api.support.attachmentUrl(m.attachment.id)}
                  alt={m.attachment.fileName}
                />
              </div>
            )}
          </div>
        ))}
      </section>

      {ticket.status !== 'closed' && (
        <form
          className="card space-y-4 p-4 sm:p-6"
          onSubmit={(e) => {
            e.preventDefault();
            void act(() => api.admin.supportReply(id, body));
          }}
        >
          <textarea
            className="input min-h-28"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            required
            maxLength={4000}
            placeholder="Javob yozing…"
          />
          <div className="grid gap-2 sm:flex">
            <button type="submit" className="btn-primary" disabled={busy || !body.trim()}>
              {busy ? 'Yuborilmoqda…' : 'Javob yuborish'}
            </button>
            <button
              type="button"
              className="btn-secondary"
              disabled={busy}
              onClick={() => void act(() => api.admin.supportClose(id))}
            >
              Murojaatni yopish
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-4">
      <dt className="text-slate-500">{label}</dt>
      <dd className="break-anywhere ml-auto text-right text-slate-900">{value}</dd>
    </div>
  );
}

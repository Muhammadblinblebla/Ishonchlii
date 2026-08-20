'use client';

import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { supportStatusLabels, uz } from '@escrowuz/shared';
import { useRequireAuth } from '@/components/AuthProvider';
import { ErrorBox, Spinner } from '@/components/ui';
import { ImagePicker } from '@/components/ImagePicker';
import { AuthImage } from '@/components/AuthImage';
import { api, ApiRequestError, type SupportTicketDetail } from '@/lib/api';
import type { PreparedImage } from '@/lib/image';
import { formatDate } from '@/lib/format';

export default function TicketPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { user, loading: authLoading } = useRequireAuth();

  const [ticket, setTicket] = useState<SupportTicketDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [body, setBody] = useState('');
  const [image, setImage] = useState<PreparedImage | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const { ticket: t } = await api.support.ticket(id);
      setTicket(t);
      setError(null);
    } catch (err) {
      setError(
        err instanceof ApiRequestError && err.status === 404
          ? 'Murojaat topilmadi'
          : 'Yuklab bo\'lmadi',
      );
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    if (user) void load();
  }, [user, load]);

  if (authLoading || loading) return <Spinner />;
  if (!user) return null;
  if (!ticket) {
    return (
      <div className="py-8">
        <ErrorBox message={error ?? 'Topilmadi'} />
        <button onClick={() => router.push('/support')} className="btn-secondary mt-4">
          Yordam bo&apos;limiga qaytish
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <button
          onClick={() => router.push('/support')}
          className="text-sm text-slate-500 hover:text-slate-700"
        >
          ← Yordam
        </button>
        <div className="mt-3 flex flex-wrap items-start justify-between gap-3">
          <h1 className="break-anywhere text-xl font-semibold text-slate-900 sm:text-2xl">
            {ticket.subject}
          </h1>
          <span className="shrink-0 rounded-full bg-slate-100 px-2.5 py-1 text-xs text-slate-600">
            {supportStatusLabels[ticket.status]}
          </span>
        </div>
      </div>

      <ErrorBox message={error} />

      <section className="space-y-3">
        {ticket.messages.map((m) => (
          <div
            key={m.id}
            className={`card p-4 ${m.fromAdmin ? 'border-brand-200 bg-brand-50' : ''}`}
          >
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-sm font-medium text-slate-900">
                {m.fromAdmin ? 'Qo\'llab-quvvatlash xizmati' : 'Siz'}
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

      {ticket.status === 'closed' ? (
        <p className="rounded-lg bg-slate-50 px-4 py-3 text-sm text-slate-600">
          Bu murojaat yopilgan. Savolingiz qolgan bo&apos;lsa yangi murojaat oching.
        </p>
      ) : (
        <form
          className="card space-y-4 p-4 sm:p-6"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError(null);
            try {
              await api.support.reply(id, {
                body,
                ...(image ? { image: { dataUrl: image.dataUrl, fileName: image.fileName } } : {}),
              });
              setBody('');
              setImage(null);
              await load();
            } catch (err) {
              setError(err instanceof ApiRequestError ? err.message : uz.common.error);
            } finally {
              setBusy(false);
            }
          }}
        >
          <textarea
            className="input min-h-24"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            required
            maxLength={4000}
            placeholder="Javob yozing…"
          />
          <ImagePicker image={image} onChange={setImage} onError={setError} />
          <button type="submit" className="btn-primary" disabled={busy || !body.trim()}>
            {busy ? 'Yuborilmoqda…' : 'Yuborish'}
          </button>
        </form>
      )}
    </div>
  );
}

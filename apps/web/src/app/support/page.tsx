'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { supportStatusLabels, supportSubjects, uz } from '@escrowuz/shared';
import { useRequireAuth } from '@/components/AuthProvider';
import { EmptyState, ErrorBox, Field, Spinner } from '@/components/ui';
import { ImagePicker } from '@/components/ImagePicker';
import { api, ApiRequestError, type SupportTicketRow } from '@/lib/api';
import type { PreparedImage } from '@/lib/image';
import { formatDateShort } from '@/lib/format';

export default function SupportPage() {
  const { user, loading: authLoading } = useRequireAuth();
  const [tickets, setTickets] = useState<SupportTicketRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [composing, setComposing] = useState(false);

  const load = useCallback(async () => {
    try {
      const { tickets: list } = await api.support.tickets();
      setTickets(list);
      setError(null);
    } catch {
      setError('Murojaatlarni yuklab bo\'lmadi');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (user) void load();
  }, [user, load]);

  if (authLoading || loading) return <Spinner />;
  if (!user) return null;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold text-slate-900">Yordam</h1>
        {!composing && (
          <button className="btn-primary" onClick={() => setComposing(true)}>
            + Murojaat yozish
          </button>
        )}
      </div>

      <ErrorBox message={error} />

      {composing && (
        <NewTicketForm
          onCancel={() => setComposing(false)}
          onDone={async () => {
            setComposing(false);
            await load();
          }}
        />
      )}

      {tickets.length === 0 && !composing ? (
        <EmptyState
          title="Savolingiz bormi?"
          text="Muammo yoki savol bo'lsa yozing — imkon qadar tez javob beramiz. Skrinshot ham biriktirishingiz mumkin."
        />
      ) : (
        <ul className="space-y-3">
          {tickets.map((t) => (
            <li key={t.id}>
              <Link
                href={`/support/${t.id}`}
                className="card flex items-center gap-3 p-4 transition-shadow hover:shadow-md"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-slate-900">{t.subject}</p>
                  <p className="mt-1 text-sm text-slate-500">
                    {t._count.messages} ta xabar · {formatDateShort(t.lastMessageAt)}
                  </p>
                </div>
                <span
                  className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset ${
                    t.status === 'open'
                      ? 'bg-amber-50 text-amber-800 ring-amber-200'
                      : t.status === 'answered'
                        ? 'bg-emerald-50 text-emerald-800 ring-emerald-200'
                        : 'bg-slate-100 text-slate-600 ring-slate-200'
                  }`}
                >
                  {supportStatusLabels[t.status]}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function NewTicketForm({
  onCancel,
  onDone,
}: {
  onCancel: () => void;
  onDone: () => Promise<void>;
}) {
  const [subject, setSubject] = useState<string>(supportSubjects[0]);
  const [body, setBody] = useState('');
  const [image, setImage] = useState<PreparedImage | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <form
      className="card space-y-4 p-4 sm:p-6"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        try {
          await api.support.create({
            subject,
            body,
            ...(image ? { image: { dataUrl: image.dataUrl, fileName: image.fileName } } : {}),
          });
          await onDone();
        } catch (err) {
          setError(err instanceof ApiRequestError ? err.message : uz.common.error);
        } finally {
          setBusy(false);
        }
      }}
    >
      <ErrorBox message={error} />

      <Field label="Nima haqida?">
        <select className="input" value={subject} onChange={(e) => setSubject(e.target.value)}>
          {supportSubjects.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </Field>

      <Field
        label="Batafsil yozing"
        hint="Qanchalik aniq yozsangiz, shunchalik tez yordam bera olamiz"
      >
        <textarea
          className="input min-h-32"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          required
          minLength={5}
          maxLength={4000}
          placeholder="Nima bo'ldi? Qaysi bosqichda muammo chiqdi?"
        />
      </Field>

      <ImagePicker image={image} onChange={setImage} onError={setError} />

      <div className="grid gap-2 sm:flex">
        <button type="submit" className="btn-primary" disabled={busy || body.trim().length < 5}>
          {busy ? 'Yuborilmoqda…' : 'Yuborish'}
        </button>
        <button type="button" className="btn-secondary" onClick={onCancel} disabled={busy}>
          {uz.common.cancel}
        </button>
      </div>
    </form>
  );
}

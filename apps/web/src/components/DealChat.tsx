'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { uz } from '@escrowuz/shared';
import { api, ApiRequestError, type ChatMessage } from '@/lib/api';
import { ErrorBox } from '@/components/ui';

/**
 * eFootball akkauntini topshirish uchun chat.
 *
 * Har 5 soniyada yangilanadi. WebSocket ishlatilmadi: savdo chati —
 * bir necha xabarlik qisqa yozishma, doimiy ulanish uchun alohida
 * infratuzilma saqlash bunga arzimaydi.
 */
export function DealChat({ dealId, canWrite }: { dealId: string; canWrite: boolean }) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      const { messages: list } = await api.chat.list(dealId);
      setMessages(list);
      setError(null);
    } catch (err) {
      // Fon yangilanishida xato ko'rsatmaymiz — foydalanuvchi yozayotgan
      // bo'lishi mumkin va qizil quti uni chalg'itadi.
      if (!loaded) {
        setError(err instanceof ApiRequestError ? err.message : uz.common.error);
      }
    } finally {
      setLoaded(true);
    }
  }, [dealId, loaded]);

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), 5000);
    return () => clearInterval(timer);
  }, [load]);

  // Yangi xabar kelganda pastga suriladi
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [messages.length]);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    const body = draft;
    if (!body.trim()) return;

    setBusy(true);
    setError(null);
    try {
      const sent = await api.chat.send(dealId, body);
      // Darhol ko'rsatamiz — keyingi yangilanishni kutmaymiz
      setMessages((prev) => [...prev, sent]);
      setDraft('');
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : uz.common.error);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card overflow-hidden">
      <div className="border-b border-slate-100 px-4 py-3 sm:px-6">
        <h2 className="font-semibold text-slate-900">{uz.chat.title}</h2>
        <p className="mt-0.5 text-xs text-slate-500">{uz.chat.hint}</p>
      </div>

      <div className="max-h-96 space-y-3 overflow-y-auto px-4 py-4 sm:px-6">
        {error && <ErrorBox message={error} />}

        {loaded && messages.length === 0 && (
          <p className="py-8 text-center text-sm text-slate-500">{uz.chat.empty}</p>
        )}

        {messages.map((m) => (
          <div key={m.id} className={`flex ${m.mine ? 'justify-end' : 'justify-start'}`}>
            <div
              className={`max-w-[85%] rounded-2xl px-3.5 py-2 text-sm ${
                m.mine
                  ? 'rounded-br-sm bg-brand-600 text-white'
                  : 'rounded-bl-sm bg-slate-100 text-slate-900'
              }`}
            >
              {/* `whitespace-pre-wrap` — parolda bo'sh joy va qator
                  ko'chishi saqlanib qolsin */}
              <p className="break-anywhere whitespace-pre-wrap">{m.body}</p>
              <p
                className={`mt-1 text-[10px] ${m.mine ? 'text-brand-100' : 'text-slate-400'}`}
              >
                {new Date(m.createdAt).toLocaleTimeString('uz-UZ', {
                  hour: '2-digit',
                  minute: '2-digit',
                })}
                {m.mine && m.readAt && ' · o’qildi'}
              </p>
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      {canWrite ? (
        <form onSubmit={send} className="flex gap-2 border-t border-slate-100 p-3 sm:px-6">
          <input
            className="input flex-1"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={uz.chat.placeholder}
            maxLength={4000}
            autoComplete="off"
          />
          <button type="submit" className="btn-primary shrink-0" disabled={busy || !draft.trim()}>
            {busy ? '…' : uz.chat.send}
          </button>
        </form>
      ) : (
        <p className="border-t border-slate-100 px-4 py-3 text-center text-xs text-slate-500 sm:px-6">
          {uz.chat.closed}
        </p>
      )}

      <p className="border-t border-slate-100 bg-slate-50 px-4 py-2 text-[11px] text-slate-500 sm:px-6">
        {uz.chat.evidence}
      </p>
    </section>
  );
}

'use client';

import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { uz } from '@escrowuz/shared';
import { ErrorBox, Spinner } from '@/components/ui';
import { formatAmount } from '@/lib/format';

const API_URL = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:3001';

interface InvoiceInfo {
  invoiceId: string;
  amountTiyin: string;
  paidAt: string | null;
  deal: { id: string; title: string; status: string } | null;
}

/**
 * SOXTA to'lov sahifasi — ishlab chiqish uchun.
 *
 * Haqiqiy provayderda bu sahifa checkout.uz tomonida bo'ladi. Bu yerda
 * shunchaki "To'ladim" tugmasi bor, lekin uning ortidagi oqim HAQIQIYSI
 * BILAN BIR XIL: server provayderdan tasdiq so'raydi, summani solishtiradi
 * va shundagina ledgerga yozadi.
 */
export default function MockPayPage() {
  const { invoiceId } = useParams<{ invoiceId: string }>();
  const router = useRouter();

  const [info, setInfo] = useState<InvoiceInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [underpay, setUnderpay] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/dev/mock-pay/${invoiceId}`);
      if (!res.ok) {
        setError(
          res.status === 404
            ? 'Hisob-faktura topilmadi. Savdo sahifasidan "To\'lov qilish" ni qayta bosing.'
            : 'Ma\'lumotni yuklab bo\'lmadi',
        );
        return;
      }
      setInfo((await res.json()) as InvoiceInfo);
    } catch {
      setError(`Serverga ulanib bo'lmadi (${API_URL}). Backend ishlayaptimi? npm run dev:api`);
    } finally {
      setLoading(false);
    }
  }, [invoiceId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function pay() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${API_URL}/dev/mock-pay/${invoiceId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          // Ataylab kam to'lash — PAYMENT_MISMATCH yo'lini sinash uchun
          underpay && info ? { amountTiyin: (BigInt(info.amountTiyin) / 2n).toString() } : {},
        ),
      });

      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as
          | { error?: { message?: string } }
          | null;
        setError(body?.error?.message ?? 'To\'lov amalga oshmadi');
        return;
      }

      const { deal } = (await res.json()) as { deal: { id: string } };
      router.push(`/deals/${deal.id}`);
    } catch {
      setError('Serverga ulanib bo\'lmadi');
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <Spinner />;

  return (
    <div className="mx-auto max-w-md py-8">
      {/* Bu sahifa haqiqiy emasligini aniq ko'rsatamiz */}
      <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
        <strong>Sinov rejimi.</strong> Bu soxta to&apos;lov sahifasi — haqiqiy pul
        yechilmaydi. Haqiqiy ishlashda bu yerda checkout.uz sahifasi ochiladi.
      </div>

      <div className="card mt-6 p-6">
        <h1 className="text-lg font-semibold text-slate-900">To&apos;lov</h1>

        <ErrorBox message={error} />

        {info && (
          <>
            {info.deal && (
              <p className="mt-4 text-sm text-slate-600">{info.deal.title}</p>
            )}

            <p className="tabular mt-2 text-3xl font-semibold text-slate-900">
              {formatAmount(info.amountTiyin)}
            </p>

            {info.paidAt ? (
              <div className="mt-6 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
                Bu hisob-faktura allaqachon to&apos;langan.
              </div>
            ) : (
              <>
                <label className="mt-6 flex items-start gap-2.5 text-sm text-slate-600">
                  <input
                    type="checkbox"
                    checked={underpay}
                    onChange={(e) => setUnderpay(e.target.checked)}
                    className="mt-0.5"
                  />
                  <span>
                    Yarim summa to&apos;lash{' '}
                    <span className="text-slate-400">
                      — savdo <code className="text-xs">PAYMENT_MISMATCH</code> holatiga
                      tushishini sinash uchun
                    </span>
                  </span>
                </label>

                <button
                  type="button"
                  className="btn-primary mt-5 w-full py-3"
                  onClick={() => void pay()}
                  disabled={busy}
                >
                  {busy ? uz.common.loading : 'To\'ladim'}
                </button>
              </>
            )}

            {info.deal && (
              <button
                type="button"
                className="btn-secondary mt-3 w-full"
                onClick={() => router.push(`/deals/${info.deal!.id}`)}
              >
                Savdoga qaytish
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}

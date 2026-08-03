'use client';

import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { autoReleaseWarning, statusLabels, uz } from '@escrowuz/shared';
import { whatHappensNow } from '@escrowuz/shared';
import { useRequireAuth } from '@/components/AuthProvider';
import {
  ConfirmDialog,
  ErrorBox,
  Field,
  ProgressSteps,
  Spinner,
  StatusBadge,
  useCountdown,
} from '@/components/ui';
import { api, ApiRequestError, type DealDetail } from '@/lib/api';
import { formatAmount, formatDate } from '@/lib/format';

type DialogKind = 'confirm' | 'cancel' | null;

export default function DealPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { user, loading: authLoading } = useRequireAuth();

  const [data, setData] = useState<DealDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [dialog, setDialog] = useState<DialogKind>(null);

  const load = useCallback(async () => {
    try {
      setData(await api.deals.get(id));
      setError(null);
    } catch (err) {
      setError(
        err instanceof ApiRequestError && err.status === 404
          ? 'Savdo topilmadi yoki sizga ruxsat yo\'q'
          : 'Savdoni yuklab bo\'lmadi',
      );
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    if (user) void load();
  }, [user, load]);

  /** Amalni bajarib, natijani qayta yuklaydi. */
  const run = useCallback(
    async (fn: () => Promise<unknown>) => {
      setBusy(true);
      setError(null);
      try {
        await fn();
        await load();
        setDialog(null);
      } catch (err) {
        setError(err instanceof ApiRequestError ? err.message : uz.common.error);
        setDialog(null);
      } finally {
        setBusy(false);
      }
    },
    [load],
  );

  if (authLoading || loading) return <Spinner />;
  if (!user) return null;

  if (!data) {
    return (
      <div className="py-8">
        <ErrorBox message={error ?? 'Savdo topilmadi'} />
        <button onClick={() => router.push('/dashboard')} className="btn-secondary mt-4">
          {uz.nav.dashboard}
        </button>
      </div>
    );
  }

  const { deal, role, buyer, seller, shipments, events, breakdown, availableActions } = data;
  const can = (action: string) => availableActions.includes(action);
  const guidance = whatHappensNow(deal.status, role);

  return (
    <div className="space-y-6">
      {/* ── Sarlavha ─────────────────────────────────────────────────────── */}
      <div>
        <button
          onClick={() => router.push('/dashboard')}
          className="text-sm text-slate-500 hover:text-slate-700"
        >
          ← {uz.nav.dashboard}
        </button>
        <div className="mt-3 flex flex-wrap items-start justify-between gap-3">
          <h1 className="text-2xl font-semibold text-slate-900">{deal.title}</h1>
          <StatusBadge status={deal.status} />
        </div>
      </div>

      <ErrorBox message={error} />

      {/* ── Progress qadamlari (§10) ─────────────────────────────────────── */}
      <div className="card p-6">
        <ProgressSteps status={deal.status} />
      </div>

      {/* ── "Hozir kim nima qilishi kerak" (§10) ─────────────────────────── */}
      <section className="card border-brand-200 bg-brand-50 p-6">
        <h2 className="text-lg font-semibold text-brand-900">{guidance.title}</h2>
        <p className="mt-1.5 text-sm leading-relaxed text-brand-800">{guidance.text}</p>

        <AutoReleaseTimer autoReleaseAt={deal.autoReleaseAt} status={deal.status} role={role} />

        {/* Amal tugmalari */}
        <div className="mt-5 flex flex-wrap gap-2">
          {can('accept') && role === 'buyer' && (
            <button
              className="btn-primary"
              disabled={busy}
              onClick={() => void run(() => api.deals.accept(deal.id, deal.version))}
            >
              {uz.deal.accept}
            </button>
          )}

          {deal.status === 'AWAITING_PAYMENT' && role === 'buyer' && (
            <button
              className="btn-primary"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  const { payUrl } = await api.deals.pay(deal.id);
                  window.location.href = payUrl;
                })
              }
            >
              {uz.deal.pay}
            </button>
          )}

          {can('ship') && role === 'seller' && (
            <ShipForm dealId={deal.id} version={deal.version} onDone={load} />
          )}

          {can('confirm') && role === 'buyer' && (
            <button className="btn-primary" disabled={busy} onClick={() => setDialog('confirm')}>
              {uz.deal.confirm}
            </button>
          )}

          {can('dispute') && role !== 'admin' && (
            <DisputeForm dealId={deal.id} onDone={load} />
          )}

          {(can('cancel') || can('refund')) && role !== 'admin' && (
            <button className="btn-secondary" disabled={busy} onClick={() => setDialog('cancel')}>
              {uz.deal.cancel}
            </button>
          )}
        </div>
      </section>

      {/* ── Summalar ─────────────────────────────────────────────────────── */}
      <section className="card p-6">
        <h2 className="font-semibold text-slate-900">Summalar</h2>
        <dl className="mt-4 space-y-3 text-sm">
          <Row label={uz.deal.amount} value={formatAmount(breakdown.amountTiyin)} />
          <Row
            label={`${uz.deal.commission} (${(deal.commissionBps / 100).toFixed(2)}%)`}
            value={formatAmount(breakdown.commissionTiyin)}
            muted
          />
          <div className="border-t border-slate-100 pt-3">
            <Row
              label={uz.deal.buyerPays}
              value={formatAmount(breakdown.buyerPaysTiyin)}
              bold={role === 'buyer'}
            />
            <div className="mt-3">
              <Row
                label={uz.deal.sellerReceives}
                value={formatAmount(breakdown.sellerReceivesTiyin)}
                bold={role === 'seller'}
              />
            </div>
          </div>
        </dl>
      </section>

      {/* ── Tomonlar va yetkazish ────────────────────────────────────────── */}
      <div className="grid gap-6 sm:grid-cols-2">
        <section className="card p-6">
          <h2 className="font-semibold text-slate-900">Tomonlar</h2>
          <dl className="mt-4 space-y-3 text-sm">
            <Row
              label={uz.deal.buyer}
              value={`${buyer?.fullName ?? '—'}${deal.buyerId === user.id ? ` (${uz.common.you})` : ''}`}
            />
            <Row
              label={uz.deal.seller}
              value={`${seller?.fullName ?? '—'}${deal.sellerId === user.id ? ` (${uz.common.you})` : ''}`}
            />
            <Row label={uz.deal.createdAt} value={formatDate(deal.createdAt)} />
          </dl>
        </section>

        {shipments.length > 0 && (
          <section className="card p-6">
            <h2 className="font-semibold text-slate-900">Yetkazib berish</h2>
            {shipments.map((s) => (
              <dl key={s.id} className="mt-4 space-y-3 text-sm">
                <Row label={uz.deal.carrier} value={s.carrier} />
                <Row label={uz.deal.tracking} value={s.trackingNumber} mono />
                <Row label="Yuborilgan" value={formatDate(s.shippedAt)} />
              </dl>
            ))}
          </section>
        )}
      </div>

      {/* ── Voqealar tarixi (§10) ────────────────────────────────────────── */}
      <section className="card p-6">
        <h2 className="font-semibold text-slate-900">{uz.deal.history}</h2>
        <ol className="mt-4 space-y-4">
          {events.map((event) => (
            <li key={event.id} className="flex gap-3 text-sm">
              <span
                className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-slate-300"
                aria-hidden
              />
              <div className="min-w-0 flex-1">
                <p className="text-slate-900">
                  {statusLabels[event.toStatus]}
                  {event.actor && (
                    <span className="text-slate-500"> — {event.actor.fullName}</span>
                  )}
                  {!event.actor && <span className="text-slate-400"> — tizim</span>}
                </p>
                {event.reason && (
                  <p className="mt-0.5 text-slate-500">{event.reason}</p>
                )}
                <p className="mt-0.5 text-xs text-slate-400">{formatDate(event.createdAt)}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      {/* ── Tasdiqlash oynalari ──────────────────────────────────────────── */}
      <ConfirmDialog
        open={dialog === 'confirm'}
        title={uz.deal.confirmDialogTitle}
        text={uz.deal.confirmDialogText}
        actionLabel={uz.deal.confirmDialogAction}
        busy={busy}
        onCancel={() => setDialog(null)}
        onConfirm={() => void run(() => api.deals.confirm(deal.id, deal.version))}
      />

      <ConfirmDialog
        open={dialog === 'cancel'}
        title="Savdoni bekor qilasizmi?"
        text={
          deal.status === 'FUNDED'
            ? 'Pul xaridorga qaytariladi. Bu amalni ortga qaytarib bo\'lmaydi.'
            : 'Savdo bekor qilinadi. Bu amalni ortga qaytarib bo\'lmaydi.'
        }
        actionLabel="Ha, bekor qilish"
        danger
        busy={busy}
        onCancel={() => setDialog(null)}
        onConfirm={() => void run(() => api.deals.cancel(deal.id))}
      />
    </div>
  );
}

// ─── Yordamchi komponentlar ──────────────────────────────────────────────────

function Row({
  label,
  value,
  bold,
  muted,
  mono,
}: {
  label: string;
  value: string;
  bold?: boolean;
  muted?: boolean;
  mono?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="text-slate-500">{label}</dt>
      <dd
        className={`tabular text-right ${bold ? 'font-semibold text-slate-900' : muted ? 'text-slate-500' : 'text-slate-900'} ${
          mono ? 'font-mono text-xs' : ''
        }`}
      >
        {value}
      </dd>
    </div>
  );
}

/** SHIPPED holatidagi qolgan vaqt (§10). */
function AutoReleaseTimer({
  autoReleaseAt,
  status,
  role,
}: {
  autoReleaseAt: string | null;
  status: DealDetail['deal']['status'];
  role: string;
}) {
  const remaining = useCountdown(autoReleaseAt);

  if (status !== 'SHIPPED' || !autoReleaseAt) return null;

  return (
    <div
      className={`mt-4 rounded-lg border px-4 py-3 text-sm ${
        remaining < 24 * 60 * 60 * 1000
          ? 'border-amber-300 bg-amber-50 text-amber-900'
          : 'border-brand-200 bg-white text-slate-700'
      }`}
    >
      <span aria-hidden className="mr-1.5">
        ⏱
      </span>
      {role === 'buyer'
        ? autoReleaseWarning(remaining)
        : `Xaridor tasdiqlashiga ${Math.ceil(remaining / 86_400_000)} kun qoldi. Vaqt tugasa pul avtomatik sizga o'tadi.`}
    </div>
  );
}

function ShipForm({
  dealId,
  version,
  onDone,
}: {
  dealId: string;
  version: number;
  onDone: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [carrier, setCarrier] = useState('');
  const [trackingNumber, setTrackingNumber] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) {
    return (
      <button className="btn-primary" onClick={() => setOpen(true)}>
        {uz.deal.ship}
      </button>
    );
  }

  return (
    <form
      className="w-full space-y-3 rounded-lg border border-slate-200 bg-white p-4"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        try {
          await api.deals.ship(dealId, { carrier, trackingNumber }, version);
          await onDone();
          setOpen(false);
        } catch (err) {
          setError(err instanceof ApiRequestError ? err.message : uz.common.error);
        } finally {
          setBusy(false);
        }
      }}
    >
      <ErrorBox message={error} />
      <Field label={uz.deal.carrier}>
        <input
          className="input"
          value={carrier}
          onChange={(e) => setCarrier(e.target.value)}
          placeholder="BTS Express, Uzpost…"
          required
          minLength={2}
        />
      </Field>
      <Field label={uz.deal.tracking}>
        <input
          className="input"
          value={trackingNumber}
          onChange={(e) => setTrackingNumber(e.target.value)}
          required
          minLength={3}
        />
      </Field>
      <div className="flex gap-2">
        <button type="submit" className="btn-primary" disabled={busy}>
          {busy ? uz.common.loading : uz.common.save}
        </button>
        <button type="button" className="btn-secondary" onClick={() => setOpen(false)}>
          {uz.common.cancel}
        </button>
      </div>
    </form>
  );
}

function DisputeForm({ dealId, onDone }: { dealId: string; onDone: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) {
    return (
      <button className="btn-danger" onClick={() => setOpen(true)}>
        {uz.deal.dispute}
      </button>
    );
  }

  return (
    <form
      className="w-full space-y-3 rounded-lg border border-red-200 bg-white p-4"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        try {
          await api.deals.dispute(dealId, reason);
          await onDone();
          setOpen(false);
        } catch (err) {
          setError(err instanceof ApiRequestError ? err.message : uz.common.error);
        } finally {
          setBusy(false);
        }
      }}
    >
      <ErrorBox message={error} />
      <Field label={uz.deal.disputeReason} hint={uz.deal.disputeHint}>
        <textarea
          className="input min-h-24"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          required
          minLength={10}
          maxLength={2000}
        />
      </Field>
      <div className="flex gap-2">
        <button type="submit" className="btn-danger" disabled={busy}>
          {busy ? uz.common.loading : uz.deal.disputeButton}
        </button>
        <button type="button" className="btn-secondary" onClick={() => setOpen(false)}>
          {uz.common.cancel}
        </button>
      </div>
    </form>
  );
}

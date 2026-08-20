'use client';

import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import {
  BUYER_ACCOUNT_CHECKLIST,
  COMMISSION_POLICY,
  SELLER_ACCOUNT_WARNING,
  autoReleaseWarning,
  chatOpenIn,
  credentialsVisibleIn,
  dealTypeRule,
  statusLabelFor,
  usesChat,
  usesContent,
  uz,
  whatHappensNow,
} from '@escrowuz/shared';
import { DealChat } from '@/components/DealChat';
import { ContentCard, ContentHandoverForm } from '@/components/DealContent';
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
  const guidance = whatHappensNow(deal.status, role, deal.dealType);
  const typeRule = dealTypeRule(deal.dealType);
  const viaChat = usesChat(deal.dealType);
  const viaContent = usesContent(deal.dealType);

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
          <div className="min-w-0">
            <h1 className="break-anywhere text-xl font-semibold text-slate-900 sm:text-2xl">
              {deal.title}
            </h1>
            <p className="mt-1 text-sm text-slate-500">
              {typeRule.label}
              {deal.game && ` · ${deal.game}`}
            </p>
          </div>
          <StatusBadge status={deal.status} dealType={deal.dealType} />
        </div>
      </div>

      <ErrorBox message={error} />

      {/* ── Progress qadamlari (§10) ─────────────────────────────────────── */}
      <div className="card p-4 sm:p-6">
        <ProgressSteps status={deal.status} dealType={deal.dealType} />
      </div>

      {/* ── "Hozir kim nima qilishi kerak" (§10) ─────────────────────────── */}
      <section className="card border-brand-200 bg-brand-50 p-4 sm:p-6">
        <h2 className="text-lg font-semibold text-brand-900">{guidance.title}</h2>
        <p className="mt-1.5 text-sm leading-relaxed text-brand-800">{guidance.text}</p>

        <AutoReleaseTimer autoReleaseAt={deal.autoReleaseAt} status={deal.status} role={role} />

        {/* Amal tugmalari */}
        {/* Mobilda tugmalar to'liq kenglikda: barmoq bilan aniq tegish uchun */}
        <div className="mt-5 grid gap-2 sm:flex sm:flex-wrap">
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

          {can('ship') && role === 'seller' && viaChat && (
            <button
              className="btn-primary"
              disabled={busy}
              onClick={() => void run(() => api.deals.markHandedOver(deal.id, deal.version))}
            >
              {typeRule.text.handoverAction}
            </button>
          )}
          {can('ship') && role === 'seller' && viaContent && (
            <ContentHandoverForm dealId={deal.id} version={deal.version} onDone={load} />
          )}
          {can('ship') && role === 'seller' && !viaChat && !viaContent && (
            <ShipForm dealId={deal.id} version={deal.version} onDone={load} />
          )}

          {can('confirm') && role === 'buyer' && (
            <button className="btn-primary" disabled={busy} onClick={() => setDialog('confirm')}>
              {typeRule.text.confirmAction}
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

      {/* ── Chat (eFootball) ─────────────────────────────────────────────── */}
      {viaChat && role !== 'admin' && chatOpenIn(deal.status) && (
        <DealChat dealId={deal.id} canWrite />
      )}

      {/* ── Raqamli mahsulot ─────────────────────────────────────────────── */}
      {/*
        `credentialsVisibleIn` — server bilan BIR XIL ro'yxat. Pul xaridorga
        qaytgan bo'lsa karta umuman ko'rsatilmaydi: tugmani bosib 403 olishdan
        ko'ra, boshidanoq ko'rinmagani tushunarliroq.
      */}
      {viaContent && role === 'buyer' && data.content && credentialsVisibleIn(deal.status) && (
        <ContentCard dealId={deal.id} />
      )}

      {/* Sotuvchi: topshirganini ko'radi, lekin qiymat qaytadan ko'rsatilmaydi */}
      {viaContent && role === 'seller' && data.content && (
        <section className="card p-4 sm:p-6">
          <h2 className="font-semibold text-slate-900">{uz.digital.contentTitle}</h2>
          <p className="mt-2 text-sm text-slate-600">
            Topshirilgan: {formatDate(data.content.createdAt)}
          </p>
          <p className="mt-1 text-sm text-slate-600">
            {data.content.viewedAt
              ? `Xaridor ochdi: ${formatDate(data.content.viewedAt)}`
              : 'Xaridor hali ochmadi.'}
          </p>
        </section>
      )}

      {/* ── Summalar ─────────────────────────────────────────────────────── */}
      <section className="card p-4 sm:p-6">
        <h2 className="font-semibold text-slate-900">Summalar</h2>
        {/*
          Xaridor to'lovidan boshlab pastga qarab taqsimlanadi — har bir tiyin
          qayerga ketgani ko'rinib tursin. Bank komissiyasi ALOHIDA qator:
          u platformaga tushmaydi va buni yashirish noto'g'ri bo'lardi.
        */}
        <dl className="mt-4 space-y-3 text-sm">
          <Row label={uz.deal.amount} value={formatAmount(breakdown.amountTiyin)} />

          <div className="border-t border-slate-100 pt-3">
            <Row
              label={uz.deal.buyerPays}
              value={formatAmount(breakdown.buyerPaysTiyin)}
              bold={role === 'buyer'}
            />
          </div>

          <div className="space-y-2 rounded-lg bg-slate-50 px-3 py-2.5 text-xs">
            <Row
              label={`Bank/karta komissiyasi (${(COMMISSION_POLICY.providerFeeBps / 100).toFixed(1)}%)`}
              value={formatAmount(breakdown.providerFeeTiyin)}
              muted
            />
            <Row
              label={`Xizmat haqqi (${(deal.commissionBps / 100).toFixed(0)}%)`}
              value={formatAmount(breakdown.commissionTiyin)}
              muted
            />
          </div>

          <Row
            label={uz.deal.sellerReceives}
            value={formatAmount(breakdown.sellerReceivesTiyin)}
            bold={role === 'seller'}
          />
        </dl>

        <p className="mt-4 border-t border-slate-100 pt-3 text-xs leading-relaxed text-slate-500">
          Bank komissiyasini to&apos;lov tizimi ushlab qoladi — platformaga tushmaydi.
        </p>
      </section>

      {/* ── Tomonlar va yetkazish ────────────────────────────────────────── */}
      <div className="grid gap-6 sm:grid-cols-2">
        <section className="card p-4 sm:p-6">
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
          <section className="card p-4 sm:p-6">
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
      <section className="card p-4 sm:p-6">
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
                  {statusLabelFor(event.toStatus, deal.dealType)}
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
      {/*
        O'yin akkauntida oddiy "ha/yo'q" oynasi YETARLI EMAS: xaridor parol va
        pochtani almashtirmasdan tasdiqlasa, sotuvchi akkauntni tiklab olishi
        mumkin va pul allaqachon o'tib bo'lgan bo'ladi. Shuning uchun alohida
        ro'yxatli oyna.
      */}
      {viaChat ? (
        <AccountConfirmDialog
          open={dialog === 'confirm'}
          busy={busy}
          onCancel={() => setDialog(null)}
          onConfirm={() => void run(() => api.deals.confirm(deal.id, deal.version))}
        />
      ) : (
        <ConfirmDialog
          open={dialog === 'confirm'}
          title={uz.deal.confirmDialogTitle}
          text={uz.deal.confirmDialogText}
          actionLabel={uz.deal.confirmDialogAction}
          busy={busy}
          onCancel={() => setDialog(null)}
          onConfirm={() => void run(() => api.deals.confirm(deal.id, deal.version))}
        />
      )}

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
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
      <dt className="text-slate-500">{label}</dt>
      <dd
        className={`tabular break-anywhere ml-auto text-right ${
          bold ? 'font-semibold text-slate-900' : muted ? 'text-slate-500' : 'text-slate-900'
        } ${mono ? 'font-mono text-xs' : ''}`}
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
      <div className="grid gap-2 sm:flex">
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

/**
 * O'yin akkaunti uchun tasdiqlash oynasi.
 *
 * Tugma ro'yxat belgilanmaguncha ishlamaydi. Bu shunchaki formallik emas:
 * eng ko'p uchraydigan yo'qotish aynan "tekshirmasdan tasdiqlash" —
 * xaridor pulini qaytarib ololmaydi, chunki savdo yakuniy holatga o'tgan.
 */
function AccountConfirmDialog({
  open,
  busy,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const [checked, setChecked] = useState(false);

  // Oyna har ochilganda belgi tozalanadi — o'tgan safar bosilgani
  // bu safar uchun hisoblanmasin.
  useEffect(() => {
    if (open) setChecked(false);
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/40 p-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:items-center sm:pb-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="account-confirm-title"
        className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-xl bg-white p-5 shadow-xl sm:p-6"
      >
        <h2 id="account-confirm-title" className="text-lg font-semibold text-slate-900">
          {uz.deal.confirmDialogTitle}
        </h2>

        <p className="mt-2 text-sm leading-relaxed text-red-700">{uz.game.checklistWarning}</p>

        <ol className="mt-4 space-y-2 text-sm text-slate-700">
          {BUYER_ACCOUNT_CHECKLIST.map((item, i) => (
            <li key={item} className="flex gap-2">
              <span className="shrink-0 tabular-nums text-slate-400">{i + 1}.</span>
              <span>{item}</span>
            </li>
          ))}
        </ol>

        <label className="mt-4 flex cursor-pointer items-start gap-3 rounded-lg bg-slate-50 p-3">
          <input
            type="checkbox"
            className="mt-0.5 h-5 w-5 shrink-0 rounded border-slate-300 text-brand-600"
            checked={checked}
            onChange={(e) => setChecked(e.target.checked)}
          />
          <span className="text-sm text-slate-900">{uz.game.checklistConfirm}</span>
        </label>

        <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button type="button" className="btn-secondary" onClick={onCancel} disabled={busy}>
            {uz.common.cancel}
          </button>
          <button
            type="button"
            className="btn-primary"
            onClick={onConfirm}
            disabled={busy || !checked}
          >
            {busy ? 'Bajarilmoqda…' : uz.deal.confirmDialogAction}
          </button>
        </div>
      </div>
    </div>
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
      <div className="grid gap-2 sm:flex">
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

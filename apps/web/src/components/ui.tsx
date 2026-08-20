'use client';

import {
  dealTypeRule,
  statusLabels,
  statusLabelFor,
  type DealStatus,
  type DealType,
} from '@escrowuz/shared';
import Link from 'next/link';
import { useEffect, useState, type ReactNode } from 'react';

// ─── Holat nishoni ───────────────────────────────────────────────────────────

const STATUS_STYLES: Record<DealStatus, string> = {
  DRAFT: 'bg-slate-100 text-slate-700 ring-slate-200',
  AWAITING_PAYMENT: 'bg-amber-50 text-amber-800 ring-amber-200',
  FUNDED: 'bg-brand-50 text-brand-800 ring-brand-200',
  SHIPPED: 'bg-indigo-50 text-indigo-800 ring-indigo-200',
  DELIVERED: 'bg-emerald-50 text-emerald-800 ring-emerald-200',
  AUTO_RELEASED: 'bg-emerald-50 text-emerald-800 ring-emerald-200',
  DISPUTED: 'bg-red-50 text-red-800 ring-red-200',
  RESOLVED_BUYER: 'bg-slate-100 text-slate-700 ring-slate-200',
  RESOLVED_SELLER: 'bg-slate-100 text-slate-700 ring-slate-200',
  RESOLVED_SPLIT: 'bg-slate-100 text-slate-700 ring-slate-200',
  REFUNDED: 'bg-slate-100 text-slate-700 ring-slate-200',
  CANCELLED: 'bg-slate-100 text-slate-500 ring-slate-200',
  EXPIRED: 'bg-slate-100 text-slate-500 ring-slate-200',
  PAYMENT_MISMATCH: 'bg-orange-50 text-orange-800 ring-orange-200',
};

export function StatusBadge({
  status,
  dealType,
}: {
  status: DealStatus;
  /** Berilsa holat nomi turga moslashadi: "Yuborildi" ↔ "Topshirildi". */
  dealType?: DealType;
}) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset ${STATUS_STYLES[status]}`}
    >
      {dealType ? statusLabelFor(status, dealType) : statusLabels[status]}
    </span>
  );
}

// ─── Progress qadamlari (§10) ────────────────────────────────────────────────

/** Uchinchi qadam savdo turiga qarab nomlanadi ("Yuborildi" / "Topshirildi"). */
function stepsFor(dealType: DealType | undefined): readonly string[] {
  return ['Kelishuv', 'To\'lov', dealTypeRule(dealType).text.handoverStep, 'Tasdiqlandi'];
}

/** Savdo qaysi qadamda ekanini aniqlaydi. -1 = to'xtatilgan. */
function stepIndexOf(status: DealStatus): number {
  switch (status) {
    case 'DRAFT': return 0;
    case 'AWAITING_PAYMENT': return 1;
    case 'FUNDED': return 2;
    case 'SHIPPED': return 3;
    case 'DELIVERED':
    case 'AUTO_RELEASED':
    case 'RESOLVED_SELLER': return 4;
    default: return -1;
  }
}

export function ProgressSteps({
  status,
  dealType,
}: {
  status: DealStatus;
  dealType?: DealType;
}) {
  const current = stepIndexOf(status);
  const halted = current === -1;
  const steps = stepsFor(dealType);

  return (
    <ol className="flex items-center gap-0.5 sm:gap-2" aria-label="Savdo bosqichlari">
      {steps.map((label, i) => {
        const done = !halted && current > i;
        const active = !halted && current === i + 1;

        return (
          <li key={label} className="flex min-w-0 flex-1 items-center gap-1 sm:gap-2">
            <div className="flex min-w-0 flex-1 flex-col items-center gap-1.5">
              <div
                className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold ring-2 ${
                  done
                    ? 'bg-emerald-500 text-white ring-emerald-500'
                    : active
                      ? 'bg-brand-600 text-white ring-brand-600'
                      : halted
                        ? 'bg-slate-100 text-slate-400 ring-slate-200'
                        : 'bg-white text-slate-400 ring-slate-200'
                }`}
              >
                {done ? '✓' : i + 1}
              </div>
              <span
                className={`w-full truncate text-center text-[10px] leading-tight sm:text-xs ${
                  done || active ? 'font-medium text-slate-900' : 'text-slate-400'
                }`}
              >
                {label}
              </span>
            </div>
            {i < steps.length - 1 && (
              <div
                className={`hidden h-0.5 w-full flex-1 sm:block ${
                  done ? 'bg-emerald-500' : 'bg-slate-200'
                }`}
              />
            )}
          </li>
        );
      })}
    </ol>
  );
}

// ─── Xato ko'rsatish ─────────────────────────────────────────────────────────

export function ErrorBox({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <div
      role="alert"
      className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
    >
      {message}
    </div>
  );
}

// ─── Tasdiqlash oynasi (§10) ─────────────────────────────────────────────────

export function ConfirmDialog({
  open,
  title,
  text,
  actionLabel,
  danger,
  busy,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  text: string;
  actionLabel: string;
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  // Escape bilan yopish — modal ichida qolib ketmaslik uchun
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onCancel();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, busy, onCancel]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/40 p-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:items-center sm:pb-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        className="w-full max-w-md rounded-xl bg-white p-5 shadow-xl sm:p-6"
      >
        <h2 id="confirm-title" className="text-lg font-semibold text-slate-900">
          {title}
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-slate-600">{text}</p>
        <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button type="button" className="btn-secondary" onClick={onCancel} disabled={busy}>
            Bekor qilish
          </button>
          <button
            type="button"
            className={danger ? 'btn-danger' : 'btn-primary'}
            onClick={onConfirm}
            disabled={busy}
          >
            {busy ? 'Bajarilmoqda…' : actionLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Bo'sh holat ─────────────────────────────────────────────────────────────

export function EmptyState({
  title,
  text,
  actionHref,
  actionLabel,
}: {
  title: string;
  text: string;
  actionHref?: string;
  actionLabel?: string;
}) {
  return (
    <div className="card px-4 py-10 text-center sm:px-6 sm:py-12">
      <p className="font-medium text-slate-900">{title}</p>
      <p className="mx-auto mt-1 max-w-sm text-sm text-slate-500">{text}</p>
      {actionHref && actionLabel && (
        <Link href={actionHref} className="btn-primary mt-6">
          {actionLabel}
        </Link>
      )}
    </div>
  );
}

// ─── Yuklanish ───────────────────────────────────────────────────────────────

export function Spinner({ label = 'Yuklanmoqda…' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-3 py-12 text-sm text-slate-500">
      <span
        className="h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-brand-600"
        aria-hidden
      />
      {label}
    </div>
  );
}

// ─── Jonli taymer ────────────────────────────────────────────────────────────

/** Har daqiqada yangilanadigan qolgan vaqt. */
export function useCountdown(targetIso: string | null): number {
  const [remaining, setRemaining] = useState(() =>
    targetIso ? Math.max(0, new Date(targetIso).getTime() - Date.now()) : 0,
  );

  useEffect(() => {
    if (!targetIso) return;
    const tick = () => setRemaining(Math.max(0, new Date(targetIso).getTime() - Date.now()));
    tick();
    const id = setInterval(tick, 60_000);
    return () => clearInterval(id);
  }, [targetIso]);

  return remaining;
}

export function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    <div>
      <label className="label">{label}</label>
      {children}
      {hint && !error && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  );
}

'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { uz } from '@escrowuz/shared';
import { useAuth } from '@/components/AuthProvider';
import { ErrorBox, Field } from '@/components/ui';
import { api, ApiRequestError } from '@/lib/api';

export default function RegisterPage() {
  const router = useRouter();
  const { user, refresh } = useAuth();
  const [form, setForm] = useState({ fullName: '', email: '', password: '', phone: '' });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (user) router.replace('/dashboard');
  }, [user, router]);

  function update(field: keyof typeof form, value: string) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await api.auth.register({
        fullName: form.fullName,
        email: form.email,
        password: form.password,
        ...(form.phone.trim() ? { phone: form.phone.trim() } : {}),
      });
      await refresh();
      router.push('/dashboard');
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : uz.common.error);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-md py-8">
      <h1 className="text-2xl font-semibold text-slate-900">{uz.auth.registerTitle}</h1>

      <form onSubmit={onSubmit} className="card mt-6 space-y-4 p-6">
        <ErrorBox message={error} />

        <Field label={uz.auth.fullName}>
          <input
            className="input"
            value={form.fullName}
            onChange={(e) => update('fullName', e.target.value)}
            required
            minLength={2}
            autoComplete="name"
            autoFocus
          />
        </Field>

        <Field label={uz.auth.email}>
          <input
            type="email"
            className="input"
            value={form.email}
            onChange={(e) => update('email', e.target.value)}
            required
            autoComplete="email"
          />
        </Field>

        <Field label={uz.auth.phone} hint={uz.auth.phonePlaceholder}>
          <input
            type="tel"
            className="input"
            value={form.phone}
            onChange={(e) => update('phone', e.target.value)}
            placeholder={uz.auth.phonePlaceholder}
            pattern="\+998[0-9]{9}"
            autoComplete="tel"
          />
        </Field>

        <Field label={uz.auth.password} hint={uz.auth.passwordHint}>
          <input
            type="password"
            className="input"
            value={form.password}
            onChange={(e) => update('password', e.target.value)}
            required
            minLength={8}
            autoComplete="new-password"
          />
        </Field>

        <button type="submit" className="btn-primary w-full py-3" disabled={busy}>
          {busy ? uz.common.loading : uz.auth.registerButton}
        </button>
      </form>

      <p className="mt-6 text-center text-sm text-slate-600">
        {uz.auth.haveAccount}{' '}
        <Link href="/login" className="font-medium text-brand-600 hover:underline">
          {uz.nav.login}
        </Link>
      </p>
    </div>
  );
}

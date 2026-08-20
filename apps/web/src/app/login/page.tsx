'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { uz } from '@escrowuz/shared';
import { useAuth } from '@/components/AuthProvider';
import { ErrorBox, Field } from '@/components/ui';
import { api, ApiRequestError } from '@/lib/api';

export default function LoginPage() {
  const router = useRouter();
  const { user, refresh } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (user) router.replace('/dashboard');
  }, [user, router]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await api.auth.login(email, password);
      await refresh();
      router.push('/dashboard');
    } catch (err) {
      // Faqat 401 da "parol noto'g'ri" deymiz. Tarmoq yoki server xatosini
      // ham shunday ko'rsatsak, foydalanuvchi parolini bekorga qidiraverardi.
      if (err instanceof ApiRequestError) {
        setError(
          err.status === 401
            ? uz.auth.invalidCredentials
            : err.status === 429
              ? 'Juda ko\'p urinish. Bir daqiqadan keyin qayta urinib ko\'ring.'
              : err.message,
        );
      } else {
        setError(uz.common.error);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-md py-8">
      <Image
        src="/logo.png"
        alt={uz.common.appName}
        width={720}
        height={564}
        priority
        className="mx-auto mb-6 h-auto w-40"
      />
      <h1 className="text-2xl font-semibold text-slate-900">{uz.auth.loginTitle}</h1>

      <form onSubmit={onSubmit} className="card mt-6 space-y-4 p-4 sm:p-6">
        <ErrorBox message={error} />

        <Field label={uz.auth.email}>
          <input
            type="email"
            className="input"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="email"
            autoFocus
          />
        </Field>

        <Field label={uz.auth.password}>
          <input
            type="password"
            className="input"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoComplete="current-password"
          />
        </Field>

        <button type="submit" className="btn-primary w-full py-3" disabled={busy}>
          {busy ? uz.common.loading : uz.auth.loginButton}
        </button>
      </form>

      <p className="mt-6 text-center text-sm text-slate-600">
        {uz.auth.noAccount}{' '}
        <Link href="/register" className="font-medium text-brand-600 hover:underline">
          {uz.nav.register}
        </Link>
      </p>
    </div>
  );
}

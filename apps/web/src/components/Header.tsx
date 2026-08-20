'use client';

import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { uz } from '@escrowuz/shared';
import { useAuth } from './AuthProvider';

export function Header() {
  const { user, loading, logout } = useAuth();
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);

  const links = user
    ? [
        { href: '/dashboard', label: uz.nav.dashboard },
        { href: '/deals/find', label: 'Sotib olish' },
        { href: '/deals/new', label: 'Sotish' },
        { href: '/wallet', label: uz.nav.wallet },
        ...(user.role === 'admin'
          ? [
              { href: '/admin/disputes', label: uz.nav.admin },
              { href: '/admin/payouts', label: 'To\'lovlar' },
            ]
          : []),
      ]
    : [];

  return (
    <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/90 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-5xl items-center justify-between gap-4 px-4 sm:px-6">
        {/*
          Logotipdagi qalqon belgisi rasm sifatida, nom esa MATN sifatida
          beriladi. Nomni ham rasmga qo'shsak, 32px balandlikda o'qib
          bo'lmasdi va Retina bo'lmagan ekranda xiralashardi.
        */}
        <Link
          href={user ? '/dashboard' : '/'}
          className="flex items-center gap-2 font-semibold"
          aria-label={uz.common.appName}
        >
          <Image
            src="/logo-mark.png"
            alt=""
            width={32}
            height={32}
            className="h-8 w-8 shrink-0"
            priority
          />
          <span className="text-slate-900">
            ishonchli<span className="text-brand-600">.uz</span>
          </span>
        </Link>

        <nav className="hidden items-center gap-1 sm:flex">
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={`rounded-lg px-3 py-2 text-sm transition-colors ${
                pathname === link.href
                  ? 'bg-brand-50 font-medium text-brand-700'
                  : 'text-slate-600 hover:bg-slate-50'
              }`}
            >
              {link.label}
            </Link>
          ))}
        </nav>

        <div className="flex items-center gap-2">
          {loading ? (
            <span className="h-8 w-20 animate-pulse rounded-lg bg-slate-100" />
          ) : user ? (
            <>
              <span className="hidden max-w-40 truncate text-sm text-slate-500 md:inline">
                {user.fullName}
              </span>
              {/* Mobilda "Chiqish" menyu ichida — yuqorida joy tor */}
              <button
                type="button"
                onClick={() => void logout()}
                className="btn-secondary hidden py-2 sm:inline-flex"
              >
                {uz.nav.logout}
              </button>
              <button
                type="button"
                className="flex h-11 w-11 items-center justify-center rounded-lg text-slate-600 hover:bg-slate-50 sm:hidden"
                onClick={() => setMenuOpen((v) => !v)}
                aria-label="Menyu"
                aria-expanded={menuOpen}
              >
                ☰
              </button>
            </>
          ) : (
            <>
              <Link href="/login" className="btn-secondary py-2">
                {uz.nav.login}
              </Link>
              <Link href="/register" className="btn-primary py-2">
                {uz.nav.register}
              </Link>
            </>
          )}
        </div>
      </div>

      {menuOpen && user && (
        <nav className="border-t border-slate-200 bg-white px-4 py-2 sm:hidden">
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              onClick={() => setMenuOpen(false)}
              className="block rounded-lg px-3 py-3 text-slate-700 hover:bg-slate-50"
            >
              {link.label}
            </Link>
          ))}
          <button
            type="button"
            onClick={() => void logout()}
            className="block w-full rounded-lg px-3 py-3 text-left text-slate-700 hover:bg-slate-50"
          >
            {uz.nav.logout}
          </button>
        </nav>
      )}
    </header>
  );
}

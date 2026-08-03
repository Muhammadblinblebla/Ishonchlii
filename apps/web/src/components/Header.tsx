'use client';

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
        { href: '/deals/new', label: uz.nav.newDeal },
        { href: '/wallet', label: uz.nav.wallet },
        ...(user.role === 'admin' ? [{ href: '/admin/disputes', label: uz.nav.admin }] : []),
      ]
    : [];

  return (
    <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/90 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-5xl items-center justify-between gap-4 px-4 sm:px-6">
        <Link href={user ? '/dashboard' : '/'} className="flex items-center gap-2 font-semibold">
          <span
            className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-600 text-sm text-white"
            aria-hidden
          >
            E
          </span>
          <span className="text-slate-900">Escrow.uz</span>
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
              <span className="hidden text-sm text-slate-500 md:inline">{user.fullName}</span>
              <button type="button" onClick={() => void logout()} className="btn-secondary py-2">
                {uz.nav.logout}
              </button>
              <button
                type="button"
                className="rounded-lg p-2 text-slate-600 hover:bg-slate-50 sm:hidden"
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
              className="block rounded-lg px-3 py-2.5 text-sm text-slate-700 hover:bg-slate-50"
            >
              {link.label}
            </Link>
          ))}
        </nav>
      )}
    </header>
  );
}

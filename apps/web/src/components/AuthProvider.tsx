'use client';

import { useRouter } from 'next/navigation';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import { api, tokens, type User } from '@/lib/api';

interface AuthState {
  user: User | null;
  loading: boolean;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  const refresh = useCallback(async () => {
    if (!tokens.access) {
      setUser(null);
      setLoading(false);
      return;
    }
    try {
      const { user: me } = await api.auth.me();
      setUser(me);
    } catch {
      // Token yaroqsiz — tozalaymiz, lekin sahifani majburan almashtirmaymiz:
      // foydalanuvchi ochiq sahifada (masalan landing) bo'lishi mumkin.
      tokens.clear();
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const logout = useCallback(async () => {
    await api.auth.logout();
    setUser(null);
    router.push('/');
  }, [router]);

  return (
    <AuthContext.Provider value={{ user, loading, refresh, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth AuthProvider ichida ishlatilishi kerak');
  return ctx;
}

/**
 * Himoyalangan sahifalar uchun.
 *
 * Diqqat: bu FAQAT foydalanuvchi qulayligi uchun. Haqiqiy himoya serverda —
 * har bir API so'rovi token va ruxsatni qayta tekshiradi.
 */
export function useRequireAuth(): AuthState {
  const auth = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!auth.loading && !auth.user) router.replace('/login');
  }, [auth.loading, auth.user, router]);

  return auth;
}

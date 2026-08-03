/**
 * API mijozi.
 *
 * Muhim qoida: summalar SATR sifatida yuriladi va `bigint` ga o'giriladi.
 * `number` ishlatilsa 2^53 dan katta summa jimgina buzilardi.
 */

import type { DealStatus } from '@escrowuz/shared';

const API_URL = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:3001';

const ACCESS_KEY = 'escrowuz.access';
const REFRESH_KEY = 'escrowuz.refresh';

export interface ApiErrorBody {
  error: { code: string; message: string; details?: unknown };
}

export class ApiRequestError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details: unknown;

  constructor(status: number, body: ApiErrorBody | null, fallback: string) {
    super(body?.error?.message ?? fallback);
    this.name = 'ApiRequestError';
    this.status = status;
    this.code = body?.error?.code ?? 'UNKNOWN';
    this.details = body?.error?.details;
  }
}

// ─── Token saqlash ───────────────────────────────────────────────────────────

export const tokens = {
  get access(): string | null {
    if (typeof window === 'undefined') return null;
    return window.localStorage.getItem(ACCESS_KEY);
  },
  get refresh(): string | null {
    if (typeof window === 'undefined') return null;
    return window.localStorage.getItem(REFRESH_KEY);
  },
  set(access: string, refresh: string): void {
    window.localStorage.setItem(ACCESS_KEY, access);
    window.localStorage.setItem(REFRESH_KEY, refresh);
  },
  clear(): void {
    window.localStorage.removeItem(ACCESS_KEY);
    window.localStorage.removeItem(REFRESH_KEY);
  },
};

// ─── So'rov yuborish ─────────────────────────────────────────────────────────

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  /** Pul harakatlantiruvchi so'rovlarda takrorlanishni bloklaydi. */
  idempotencyKey?: string;
  /** `true` bo'lsa 401 da token yangilashga urinilmaydi (cheksiz sikl oldini olish). */
  skipRefresh?: boolean;
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, idempotencyKey, skipRefresh } = options;

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const access = tokens.access;
  if (access) headers['Authorization'] = `Bearer ${access}`;
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;

  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      method,
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch {
    // Tarmoq xatosi: server o'chiq, CORS bloklagan yoki internet yo'q.
    // Umumiy "xatolik yuz berdi" o'rniga aniq sabab ko'rsatiladi —
    // aks holda foydalanuvchi nima qilishni bilmay qoladi.
    throw new ApiRequestError(
      0,
      {
        error: {
          code: 'NETWORK_ERROR',
          message: `Serverga ulanib bo'lmadi (${API_URL}). Backend ishga tushirilganini tekshiring: npm run dev:api`,
        },
      },
      'Serverga ulanib bo\'lmadi',
    );
  }

  // Access token muddati tugagan bo'lsa bir marta yangilaymiz va qaytaramiz.
  if (res.status === 401 && !skipRefresh && tokens.refresh) {
    const renewed = await tryRefresh();
    if (renewed) return request<T>(path, { ...options, skipRefresh: true });
  }

  if (res.status === 204) return undefined as T;

  let parsed: unknown = null;
  const text = await res.text();
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = null;
    }
  }

  if (!res.ok) {
    throw new ApiRequestError(res.status, parsed as ApiErrorBody | null, 'So\'rov bajarilmadi');
  }

  return parsed as T;
}

async function tryRefresh(): Promise<boolean> {
  const refreshToken = tokens.refresh;
  if (!refreshToken) return false;

  try {
    const res = await fetch(`${API_URL}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    });
    if (!res.ok) {
      tokens.clear();
      return false;
    }
    const data = (await res.json()) as { accessToken: string; refreshToken: string };
    tokens.set(data.accessToken, data.refreshToken);
    return true;
  } catch {
    return false;
  }
}

// ─── Tiplar ──────────────────────────────────────────────────────────────────

export interface User {
  id: string;
  email: string;
  fullName: string;
  phone: string | null;
  role: 'user' | 'admin';
  isVerified: boolean;
}

export interface Deal {
  id: string;
  buyerId: string;
  sellerId: string;
  title: string;
  description: string;
  /** Tiyinda, SATR. `BigInt(...)` bilan o'giriladi. */
  amountTiyin: string;
  commissionTiyin: string;
  commissionBps: number;
  commissionPayer: 'buyer' | 'seller' | 'split';
  status: DealStatus;
  version: number;
  createdAt: string;
  acceptedAt: string | null;
  fundedAt: string | null;
  shippedAt: string | null;
  completedAt: string | null;
  autoReleaseAt: string | null;
  paymentDueAt: string | null;
}

export interface DealEvent {
  id: string;
  fromStatus: DealStatus | null;
  toStatus: DealStatus;
  action: string;
  reason: string | null;
  createdAt: string;
  actor: { fullName: string } | null;
}

export interface DealDetail {
  deal: Deal;
  role: 'buyer' | 'seller' | 'admin';
  buyer: { id: string; fullName: string; email: string } | null;
  seller: { id: string; fullName: string; email: string } | null;
  shipments: Array<{ id: string; carrier: string; trackingNumber: string; shippedAt: string }>;
  events: DealEvent[];
  dispute: { id: string; reason: string; status: string } | null;
  breakdown: {
    amountTiyin: string;
    buyerPaysTiyin: string;
    sellerReceivesTiyin: string;
    commissionTiyin: string;
  };
  availableActions: string[];
}

export interface AdminDispute {
  id: string;
  reason: string;
  status: string;
  createdAt: string;
  evidenceDueAt: string;
  resolvedAt: string | null;
  deal: { id: string; title: string; status: DealStatus; amountTiyin: string };
  opener: { id: string; fullName: string; email: string };
  files: Array<{ id: string; originalFilename: string }>;
}

export interface AdminDisputeDetail {
  dispute: AdminDispute & { resolutionNote: string | null };
  buyer: { id: string; fullName: string; email: string } | null;
  seller: { id: string; fullName: string; email: string } | null;
  events: DealEvent[];
  shipments: Array<{ id: string; carrier: string; trackingNumber: string }>;
  escrowTiyin: string;
  breakdown: { amountTiyin: string; commissionTiyin: string };
}

export interface Wallet {
  availableTiyin: string;
  pendingTiyin: string;
  totalTiyin: string;
}

export interface Transaction {
  id: string;
  accountId: string;
  amount: string;
  entryType: string;
  createdAt: string;
  deal: { id: string; title: string; status: DealStatus } | null;
}

// ─── Endpointlar ─────────────────────────────────────────────────────────────

interface AuthResponse {
  user: User;
  accessToken: string;
  refreshToken: string;
}

export const api = {
  auth: {
    async register(input: {
      email: string;
      password: string;
      fullName: string;
      phone?: string;
    }): Promise<User> {
      const data = await request<AuthResponse>('/auth/register', { method: 'POST', body: input });
      tokens.set(data.accessToken, data.refreshToken);
      return data.user;
    },

    async login(email: string, password: string): Promise<User> {
      const data = await request<AuthResponse>('/auth/login', {
        method: 'POST',
        body: { email, password },
      });
      tokens.set(data.accessToken, data.refreshToken);
      return data.user;
    },

    async logout(): Promise<void> {
      const refreshToken = tokens.refresh;
      if (refreshToken) {
        await request('/auth/logout', { method: 'POST', body: { refreshToken } }).catch(
          () => undefined,
        );
      }
      tokens.clear();
    },

    me(): Promise<{ user: User }> {
      return request('/auth/me');
    },
  },

  deals: {
    list(params: { status?: string; role?: string } = {}): Promise<{ deals: Deal[] }> {
      const query = new URLSearchParams(
        Object.entries(params).filter(([, v]) => v !== undefined) as [string, string][],
      );
      return request(`/deals${query.toString() ? `?${query}` : ''}`);
    },

    get(id: string): Promise<DealDetail> {
      return request(`/deals/${id}`);
    },

    create(input: {
      title: string;
      description: string;
      amountTiyin: string;
      commissionPayer: 'buyer' | 'seller' | 'split';
      counterpartyEmail: string;
      myRole: 'buyer' | 'seller';
    }): Promise<{ deal: Deal }> {
      return request('/deals', {
        method: 'POST',
        body: input,
        idempotencyKey: crypto.randomUUID(),
      });
    },

    preview(
      amountTiyin: string,
      commissionPayer: string,
    ): Promise<{
      breakdown: {
        buyerPaysTiyin: string;
        sellerReceivesTiyin: string;
        commissionTiyin: string;
      };
    }> {
      return request(`/deals/preview?amountTiyin=${amountTiyin}&commissionPayer=${commissionPayer}`);
    },

    accept(id: string, version: number): Promise<{ deal: Deal }> {
      return request(`/deals/${id}/accept`, {
        method: 'POST',
        body: { expectedVersion: version },
        idempotencyKey: crypto.randomUUID(),
      });
    },

    pay(id: string): Promise<{ payUrl: string; invoiceId: string; amountTiyin: string }> {
      return request(`/deals/${id}/pay`, { method: 'POST', body: {} });
    },

    ship(
      id: string,
      data: { carrier: string; trackingNumber: string; note?: string },
      version: number,
    ): Promise<{ deal: Deal }> {
      return request(`/deals/${id}/ship`, {
        method: 'POST',
        body: { ...data, expectedVersion: version },
        idempotencyKey: crypto.randomUUID(),
      });
    },

    confirm(id: string, version: number): Promise<{ deal: Deal }> {
      return request(`/deals/${id}/confirm`, {
        method: 'POST',
        body: { expectedVersion: version },
        idempotencyKey: crypto.randomUUID(),
      });
    },

    cancel(id: string, reason?: string): Promise<{ deal: Deal }> {
      return request(`/deals/${id}/cancel`, {
        method: 'POST',
        body: { reason },
        idempotencyKey: crypto.randomUUID(),
      });
    },

    dispute(id: string, reason: string): Promise<{ deal: Deal }> {
      return request(`/deals/${id}/dispute`, {
        method: 'POST',
        body: { reason },
        idempotencyKey: crypto.randomUUID(),
      });
    },
  },

  admin: {
    stats(): Promise<{
      openDisputes: number;
      paymentMismatches: number;
      activeDeals: number;
      escrowTiyin: string;
    }> {
      return request('/admin/stats');
    },

    disputes(status: 'open' | 'resolved' | 'all' = 'open'): Promise<{ disputes: AdminDispute[] }> {
      return request(`/admin/disputes?status=${status}`);
    },

    dispute(id: string): Promise<AdminDisputeDetail> {
      return request(`/admin/disputes/${id}`);
    },

    /** Qaror qabul qilishdan oldin pul taqsimotini ko'rsatadi. */
    previewSplit(
      id: string,
      buyerSharePercent: number,
    ): Promise<{
      escrowTiyin: string;
      split: { toBuyerTiyin: string; toSellerTiyin: string; toPlatformTiyin: string };
    }> {
      return request(`/admin/disputes/${id}/preview?buyerSharePercent=${buyerSharePercent}`);
    },

    resolve(
      id: string,
      input: { resolution: 'buyer' | 'seller' | 'split'; buyerSharePercent?: number; note: string },
    ): Promise<unknown> {
      return request(`/admin/disputes/${id}/resolve`, {
        method: 'POST',
        body: input,
        idempotencyKey: crypto.randomUUID(),
      });
    },
  },

  wallet: {
    get(): Promise<Wallet> {
      return request('/wallet');
    },
    transactions(): Promise<{ transactions: Transaction[] }> {
      return request('/wallet/transactions');
    },
    payout(amountTiyin: string, destination: string): Promise<unknown> {
      return request('/wallet/payout', {
        method: 'POST',
        body: { amountTiyin, destination },
        idempotencyKey: crypto.randomUUID(),
      });
    },
  },
};

/**
 * QO'LDA TO'LOV OQIMI.
 *
 * checkout.uz pul chiqarishni qo'llab-quvvatlamaydi (hujjatdagi 8 ta
 * endpointning birortasi ham pul yubormaydi). Shuning uchun sotuvchiga
 * to'lov admin tomonidan bank orqali bajariladi.
 *
 * Bu testlar aynan shu yo'lni tekshiradi: pul hisobdan yechiladi, so'rov
 * admin navbatida qoladi, admin "o'tkazdim" yoki "bajara olmadim" deb
 * belgilaydi.
 *
 * ENG MUHIM TEKSHIRUV: "o'tkazdim" bosilganda ledgerga QO'SHIMCHA yozuv
 * qo'shilmasligi kerak — pul so'rov paytida allaqachon yechilgan. Aks holda
 * u ikki marta chiqardi.
 */

import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/db/prisma.js';
import { getBalance, post, depositLegs, releaseLegs } from '../src/ledger/ledger.service.js';
import { MockPaymentProvider } from '../src/payments/mock.provider.js';
import { setPaymentProvider } from '../src/payments/index.js';
import type { PaymentProvider } from '../src/payments/provider.js';
import { cleanupTestUsers, createTestUser, makeApp, type TestUser } from './helpers/setup.js';
import { randomUUID } from 'node:crypto';

/** checkout.uz kabi — pul qabul qiladi, lekin chiqarmaydi. */
class NoPayoutProvider extends MockPaymentProvider {
  override readonly supportsPayout = false;
}

let app: FastifyInstance;
let seller: TestUser;
let admin: TestUser;

const auth = (u: TestUser): Record<string, string> => ({ authorization: `Bearer ${u.token}` });

/** Sotuvchiga yechib olinadigan mablag' beradi (haqiqiy savdo siklisiz). */
async function giveBalance(userId: string, tiyin: bigint): Promise<void> {
  await post({ legs: depositLegs(userId, tiyin, 0n, 'test'), idempotencyKey: `mp-d-${randomUUID()}` });
  await post({
    legs: releaseLegs(userId, tiyin, tiyin, 0n),
    idempotencyKey: `mp-r-${randomUUID()}`,
  });
}

beforeAll(async () => {
  app = await makeApp();
  admin = await createTestUser('mp-admin', 'admin');
});

beforeEach(() => {
  setPaymentProvider(new NoPayoutProvider() as unknown as PaymentProvider);
});

afterAll(async () => {
  setPaymentProvider(null);
  await app.close();
  await cleanupTestUsers();
  await prisma.$disconnect();
});

describe('Provayder pul chiqarishni qo\'llab-quvvatlamasa', () => {
  it('so\'rov XATO BERMAYDI, admin navbatiga tushadi', async () => {
    seller = await createTestUser('mp-s1');
    await giveBalance(seller.id, 10_000_000n);

    const res = await app.inject({
      method: 'POST',
      url: '/wallet/payout',
      headers: auth(seller),
      payload: { amountTiyin: '4000000', destination: '8600123456789012' },
    });

    expect(res.statusCode, res.body).toBe(200);
    const body = res.json() as Record<string, any>;
    expect(body['manual']).toBe(true);
    expect(body['payout'].status).toBe('pending');
    // Foydalanuvchi nima kutishini bilishi kerak
    expect(body['message']).toContain('ish kuni');
  });

  it('pul DARHOL hisobdan yechiladi — ikki marta so\'rab bo\'lmaydi', async () => {
    seller = await createTestUser('mp-s2');
    await giveBalance(seller.id, 10_000_000n);

    await app.inject({
      method: 'POST', url: '/wallet/payout', headers: auth(seller),
      payload: { amountTiyin: '6000000', destination: '8600123456789012' },
    });

    expect((await getBalance(seller.id)).availableTiyin).toBe(4_000_000n);

    // Qolgan mablag'dan ko'p so'rash rad etiladi
    const tooMuch = await app.inject({
      method: 'POST', url: '/wallet/payout', headers: auth(seller),
      payload: { amountTiyin: '6000000', destination: '8600123456789012' },
    });
    expect(tooMuch.statusCode).toBe(400);
    expect((tooMuch.json() as Record<string, any>).error.code).toBe('INSUFFICIENT_FUNDS');
  });

  it('karta raqami bazada MASKALANGAN holda saqlanadi (§11)', async () => {
    seller = await createTestUser('mp-s3');
    await giveBalance(seller.id, 10_000_000n);

    await app.inject({
      method: 'POST', url: '/wallet/payout', headers: auth(seller),
      payload: { amountTiyin: '1000000', destination: '8600123456789012' },
    });

    const payout = await prisma.payout.findFirst({
      where: { userId: seller.id },
      orderBy: { createdAt: 'desc' },
    });
    expect(payout!.destination).toBe('8600********9012');
    expect(payout!.destination).not.toContain('123456789');
  });
});

describe('Admin to\'lov navbati', () => {
  it('kutilayotgan so\'rovlarni ko\'radi', async () => {
    seller = await createTestUser('mp-s4');
    await giveBalance(seller.id, 10_000_000n);
    await app.inject({
      method: 'POST', url: '/wallet/payout', headers: auth(seller),
      payload: { amountTiyin: '3000000', destination: '8600123456789012' },
    });

    const res = await app.inject({
      method: 'GET', url: '/admin/payouts?status=pending', headers: auth(admin),
    });
    expect(res.statusCode, res.body).toBe(200);

    const payouts = (res.json() as Record<string, any>)['payouts'] as Array<Record<string, any>>;
    const mine = payouts.find((p) => p['user'].id === seller.id);
    expect(mine).toBeDefined();
    expect(mine!['amountTiyin']).toBe('3000000');
    // Admin kimga o'tkazishni bilishi kerak
    expect(mine!['user'].fullName).toBeTruthy();
  });

  it('oddiy foydalanuvchi to\'lov navbatini KO\'RA OLMAYDI', async () => {
    const stranger = await createTestUser('mp-x');
    const res = await app.inject({
      method: 'GET', url: '/admin/payouts', headers: auth(stranger),
    });
    expect(res.statusCode).toBe(403);
  });

  it('"o\'tkazdim" — holat o\'zgaradi, LEDGER TEGILMAYDI', async () => {
    seller = await createTestUser('mp-s5');
    await giveBalance(seller.id, 10_000_000n);
    await app.inject({
      method: 'POST', url: '/wallet/payout', headers: auth(seller),
      payload: { amountTiyin: '2000000', destination: '8600123456789012' },
    });

    const payout = await prisma.payout.findFirstOrThrow({
      where: { userId: seller.id }, orderBy: { createdAt: 'desc' },
    });

    const balanceBefore = await getBalance(seller.id);
    const entriesBefore = await prisma.ledgerEntry.count();

    const res = await app.inject({
      method: 'POST',
      url: `/admin/payouts/${payout.id}/complete`,
      headers: auth(admin),
      payload: { reference: 'Bank o\'tkazmasi #12345' },
    });
    expect(res.statusCode, res.body).toBe(200);

    // ⚠️ ENG MUHIM: pul allaqachon yechilgan, qo'shimcha yozuv BO'LMASLIGI kerak
    expect(await prisma.ledgerEntry.count()).toBe(entriesBefore);
    expect((await getBalance(seller.id)).availableTiyin).toBe(balanceBefore.availableTiyin);

    const updated = await prisma.payout.findUniqueOrThrow({ where: { id: payout.id } });
    expect(updated.status).toBe('completed');
    expect(updated.providerRef).toBe('Bank o\'tkazmasi #12345');
  });

  it('bir xil so\'rovni ikki marta "bajarildi" qilib bo\'lmaydi', async () => {
    seller = await createTestUser('mp-s6');
    await giveBalance(seller.id, 10_000_000n);
    await app.inject({
      method: 'POST', url: '/wallet/payout', headers: auth(seller),
      payload: { amountTiyin: '1000000', destination: '8600123456789012' },
    });
    const payout = await prisma.payout.findFirstOrThrow({
      where: { userId: seller.id }, orderBy: { createdAt: 'desc' },
    });

    const first = await app.inject({
      method: 'POST', url: `/admin/payouts/${payout.id}/complete`,
      headers: auth(admin), payload: { reference: 'birinchi' },
    });
    expect(first.statusCode).toBe(200);

    const second = await app.inject({
      method: 'POST', url: `/admin/payouts/${payout.id}/complete`,
      headers: auth(admin), payload: { reference: 'ikkinchi' },
    });
    expect(second.statusCode).toBe(409);
  });

  it('"bajara olmadim" — pul hisobga QAYTARILADI', async () => {
    seller = await createTestUser('mp-s7');
    await giveBalance(seller.id, 10_000_000n);
    await app.inject({
      method: 'POST', url: '/wallet/payout', headers: auth(seller),
      payload: { amountTiyin: '7000000', destination: '8600123456789012' },
    });

    expect((await getBalance(seller.id)).availableTiyin).toBe(3_000_000n);

    const payout = await prisma.payout.findFirstOrThrow({
      where: { userId: seller.id }, orderBy: { createdAt: 'desc' },
    });

    const res = await app.inject({
      method: 'POST',
      url: `/admin/payouts/${payout.id}/reject`,
      headers: auth(admin),
      payload: { reason: 'Karta raqami noto\'g\'ri, bank rad etdi' },
    });
    expect(res.statusCode, res.body).toBe(200);

    // Pul to'liq qaytdi
    expect((await getBalance(seller.id)).availableTiyin).toBe(10_000_000n);

    const updated = await prisma.payout.findUniqueOrThrow({ where: { id: payout.id } });
    expect(updated.status).toBe('failed');
    expect(updated.failReason).toContain('Karta raqami');
  });

  it('bajarilgan so\'rovni bekor qilib bo\'lmaydi', async () => {
    seller = await createTestUser('mp-s8');
    await giveBalance(seller.id, 10_000_000n);
    await app.inject({
      method: 'POST', url: '/wallet/payout', headers: auth(seller),
      payload: { amountTiyin: '1000000', destination: '8600123456789012' },
    });
    const payout = await prisma.payout.findFirstOrThrow({
      where: { userId: seller.id }, orderBy: { createdAt: 'desc' },
    });

    await app.inject({
      method: 'POST', url: `/admin/payouts/${payout.id}/complete`,
      headers: auth(admin), payload: { reference: 'bajarildi' },
    });

    const res = await app.inject({
      method: 'POST', url: `/admin/payouts/${payout.id}/reject`,
      headers: auth(admin), payload: { reason: 'Fikrimdan qaytdim, bekor qilaman' },
    });
    expect(res.statusCode).toBe(409);
  });
});

describe('Ledger buzilmadi', () => {
  it('umumiy yig\'indi 0', async () => {
    const total = await prisma.ledgerEntry.aggregate({ _sum: { amount: true } });
    expect(total._sum.amount ?? 0n).toBe(0n);
  });

  it('hech kimning balansi manfiy emas', async () => {
    const negative = await prisma.$queryRaw<Array<{ account_id: string }>>`
      SELECT account_id FROM ledger_entries
       WHERE account_id LIKE 'user:%:available'
       GROUP BY account_id HAVING SUM(amount) < 0
    `;
    expect(negative).toHaveLength(0);
  });
});

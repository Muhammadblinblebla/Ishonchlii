/**
 * §12 — MAJBURIY TESTLAR.
 *
 * Har biri spetsifikatsiyadagi bandga to'g'ridan-to'g'ri mos keladi.
 * Bular haqiqiy bazaga, haqiqiy HTTP so'rovlariga va haqiqiy ledgerga tegadi.
 */

import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/db/prisma.js';
import { getBalance } from '../src/ledger/ledger.service.js';
import { MockPaymentProvider } from '../src/payments/mock.provider.js';
import { setPaymentProvider } from '../src/payments/index.js';
import { cleanupTestUsers, createTestUser, makeApp, uniqueEmail } from './helpers/setup.js';

let app: FastifyInstance;
let provider: MockPaymentProvider;

const AMOUNT = '10000000'; // 100 000 so'm, tiyinda

type Actor = Awaited<ReturnType<typeof createTestUser>>;

const makeActor = (tag: string): Promise<Actor> => createTestUser(tag);

function auth(actor: Actor): Record<string, string> {
  return { authorization: `Bearer ${actor.token}` };
}

/** DRAFT holatidagi savdo yaratadi. */
async function createDeal(seller: Actor, buyer: Actor, amountTiyin = AMOUNT) {
  const res = await app.inject({
    method: 'POST',
    url: '/deals',
    headers: auth(seller),
    payload: {
      title: 'Test tovar',
      description: 'Sinov uchun',
      amountTiyin,
      commissionPayer: 'seller',
      counterpartyEmail: buyer.email,
      myRole: 'seller',
    },
  });
  expect(res.statusCode, res.body).toBe(201);
  return (res.json() as Record<string, any>)['deal'];
}

/** Savdoni FUNDED holatiga olib boradi. */
async function fundDeal(dealId: string, buyer: Actor, options: { amountTiyin?: bigint } = {}) {
  const accept = await app.inject({
    method: 'POST',
    url: `/deals/${dealId}/accept`,
    headers: auth(buyer),
    payload: {},
  });
  expect(accept.statusCode, accept.body).toBe(200);

  const pay = await app.inject({
    method: 'POST',
    url: `/deals/${dealId}/pay`,
    headers: auth(buyer),
    payload: {},
  });
  expect(pay.statusCode, pay.body).toBe(200);
  const invoiceId = (pay.json() as Record<string, any>)['invoiceId'] as string;

  // Xaridor haqiqatda to'laydi (provayder tomonidagi holat o'zgaradi)
  provider.simulatePayment(invoiceId, options);

  const webhook = provider.buildWebhook(invoiceId);
  const res = await app.inject({
    method: 'POST',
    url: '/webhooks/checkout-uz',
    headers: { ...webhook.headers },
    payload: webhook.body,
  });
  expect(res.statusCode).toBe(200);

  return { invoiceId, webhook };
}

async function getDeal(dealId: string, actor: Actor) {
  const res = await app.inject({ method: 'GET', url: `/deals/${dealId}`, headers: auth(actor) });
  return { status: res.statusCode, body: res.json() as Record<string, any> };
}

// ─────────────────────────────────────────────────────────────────────────────

beforeAll(async () => {
  app = await makeApp();
});

beforeEach(() => {
  provider = new MockPaymentProvider();
  setPaymentProvider(provider);
});

afterAll(async () => {
  setPaymentProvider(null);
  await app.close();
  await cleanupTestUsers();
  await prisma.$disconnect();
});

// ─────────────────────────────────────────────────────────────────────────────

describe('§12 — To\'liq muvaffaqiyatli savdo', () => {
  it('yaratish → qabul → to\'lov → yuborish → tasdiq', async () => {
    const seller = await makeActor('flow-s');
    const buyer = await makeActor('flow-b');
    const deal = await createDeal(seller, buyer);

    expect(deal.status).toBe('DRAFT');

    await fundDeal(deal.id, buyer);
    expect((await getDeal(deal.id, buyer)).body['deal'].status).toBe('FUNDED');

    // Pul muzlatilgan — sotuvchi hali yecha olmaydi
    const funded = await getBalance(seller.id);
    expect(funded.pendingTiyin).toBe(10_000_000n);
    expect(funded.availableTiyin).toBe(0n);

    const ship = await app.inject({
      method: 'POST',
      url: `/deals/${deal.id}/ship`,
      headers: auth(seller),
      payload: { carrier: 'BTS Express', trackingNumber: 'BTS123456789' },
    });
    expect(ship.statusCode, ship.body).toBe(200);
    expect((ship.json() as Record<string, any>)['deal'].status).toBe('SHIPPED');

    const confirm = await app.inject({
      method: 'POST',
      url: `/deals/${deal.id}/confirm`,
      headers: auth(buyer),
      payload: {},
    });
    expect(confirm.statusCode, confirm.body).toBe(200);
    expect((confirm.json() as Record<string, any>)['deal'].status).toBe('DELIVERED');

    // Pul sotuvchida, komissiya ushlangan
    const done = await getBalance(seller.id);
    expect(done.availableTiyin).toBe(9_700_000n);
    expect(done.pendingTiyin).toBe(0n);
  });

  it('har yakunda ledger yig\'indisi = 0', async () => {
    const seller = await makeActor('sum-s');
    const buyer = await makeActor('sum-b');
    const deal = await createDeal(seller, buyer);
    await fundDeal(deal.id, buyer);

    await app.inject({
      method: 'POST', url: `/deals/${deal.id}/ship`, headers: auth(seller),
      payload: { carrier: 'BTS Express', trackingNumber: 'TRK123456' },
    });
    await app.inject({
      method: 'POST', url: `/deals/${deal.id}/confirm`, headers: auth(buyer), payload: {},
    });

    const entries = await prisma.ledgerEntry.findMany({ where: { dealId: deal.id } });
    expect(entries.length).toBeGreaterThan(0);
    expect(entries.reduce((s, e) => s + e.amount, 0n)).toBe(0n);
  });
});

describe('§12 — Ikki marta confirm: pul ikki marta o\'tmaydi', () => {
  it('ketma-ket ikkinchi confirm rad etiladi va balans o\'zgarmaydi', async () => {
    const seller = await makeActor('dbl-s');
    const buyer = await makeActor('dbl-b');
    const deal = await createDeal(seller, buyer);
    await fundDeal(deal.id, buyer);
    await app.inject({
      method: 'POST', url: `/deals/${deal.id}/ship`, headers: auth(seller),
      payload: { carrier: 'BTS Express', trackingNumber: 'TRK123456' },
    });

    const first = await app.inject({
      method: 'POST', url: `/deals/${deal.id}/confirm`, headers: auth(buyer), payload: {},
    });
    expect(first.statusCode).toBe(200);

    const balanceAfterFirst = await getBalance(seller.id);

    const second = await app.inject({
      method: 'POST', url: `/deals/${deal.id}/confirm`, headers: auth(buyer), payload: {},
    });
    // DELIVERED yakuniy holat — o'tish rad etiladi
    expect(second.statusCode).toBe(409);

    const balanceAfterSecond = await getBalance(seller.id);
    expect(balanceAfterSecond.availableTiyin).toBe(balanceAfterFirst.availableTiyin);
    expect(balanceAfterFirst.availableTiyin).toBe(9_700_000n);
  });
});

describe('§12 — Ikkita PARALLEL confirm (race condition)', () => {
  it('faqat bittasi o\'tadi, pul bir marta hisoblanadi', async () => {
    const seller = await makeActor('race-s');
    const buyer = await makeActor('race-b');
    const deal = await createDeal(seller, buyer);
    await fundDeal(deal.id, buyer);
    await app.inject({
      method: 'POST', url: `/deals/${deal.id}/ship`, headers: auth(seller),
      payload: { carrier: 'BTS Express', trackingNumber: 'TRK123456' },
    });

    // Bir vaqtda 5 ta so'rov
    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        app.inject({
          method: 'POST', url: `/deals/${deal.id}/confirm`, headers: auth(buyer), payload: {},
        }),
      ),
    );

    const ok = results.filter((r) => r.statusCode === 200);
    expect(ok.length, 'faqat bitta so\'rov muvaffaqiyatli bo\'lishi kerak').toBe(1);

    const balance = await getBalance(seller.id);
    expect(balance.availableTiyin).toBe(9_700_000n); // 19 400 000 emas

    const entries = await prisma.ledgerEntry.findMany({ where: { dealId: deal.id } });
    expect(entries.reduce((s, e) => s + e.amount, 0n)).toBe(0n);
  });
});

describe('§12 — Webhook idempotentligi', () => {
  it('bir xil webhook 2 marta kelsa bitta marta ishlanadi', async () => {
    const seller = await makeActor('wh-s');
    const buyer = await makeActor('wh-b');
    const deal = await createDeal(seller, buyer);
    const { webhook } = await fundDeal(deal.id, buyer);

    const balanceAfterFirst = await getBalance(seller.id);
    expect(balanceAfterFirst.pendingTiyin).toBe(10_000_000n);

    // AYNAN bir xil webhook qayta keladi
    const repeat = await app.inject({
      method: 'POST',
      url: '/webhooks/checkout-uz',
      headers: { ...webhook.headers },
      payload: webhook.body,
    });
    expect(repeat.statusCode).toBe(200);
    expect((repeat.json() as Record<string, any>)['duplicate']).toBe(true);

    const balanceAfterSecond = await getBalance(seller.id);
    expect(balanceAfterSecond.pendingTiyin).toBe(10_000_000n); // 20 000 000 emas
  });

  it('imzosiz webhook hech narsa o\'zgartirmaydi', async () => {
    const seller = await makeActor('nosig-s');
    const buyer = await makeActor('nosig-b');
    const deal = await createDeal(seller, buyer);

    await app.inject({
      method: 'POST', url: `/deals/${deal.id}/accept`, headers: auth(buyer), payload: {},
    });
    const pay = await app.inject({
      method: 'POST', url: `/deals/${deal.id}/pay`, headers: auth(buyer), payload: {},
    });
    const invoiceId = (pay.json() as Record<string, any>)['invoiceId'] as string;

    const wh = provider.buildWebhook(invoiceId);
    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/checkout-uz',
      headers: { 'content-type': 'application/json' }, // imzosiz
      payload: wh.body,
    });

    expect(res.statusCode).toBe(200); // provayderga har doim 200
    expect((await getDeal(deal.id, buyer)).body['deal'].status).toBe('AWAITING_PAYMENT');
  });

  it('PUL TO\'LANMASDAN kelgan webhook savdoni FUNDED qilmaydi', async () => {
    // checkout.uz webhook'ga imzo qo'ymaydi → soxta webhook yuborish mumkin.
    // Tizim provayderdan tasdiq so'raydi va haqiqatni bilib oladi.
    const seller = await makeActor('fake-s');
    const buyer = await makeActor('fake-b');
    const deal = await createDeal(seller, buyer);

    await app.inject({
      method: 'POST', url: `/deals/${deal.id}/accept`, headers: auth(buyer), payload: {},
    });
    const pay = await app.inject({
      method: 'POST', url: `/deals/${deal.id}/pay`, headers: auth(buyer), payload: {},
    });
    const invoiceId = (pay.json() as Record<string, any>)['invoiceId'] as string;

    // simulatePayment CHAQIRILMAYDI — ya'ni pul to'lanmagan
    const wh = provider.buildWebhook(invoiceId);
    await app.inject({
      method: 'POST', url: '/webhooks/checkout-uz', headers: { ...wh.headers }, payload: wh.body,
    });

    expect((await getDeal(deal.id, buyer)).body['deal'].status).toBe('AWAITING_PAYMENT');
    expect((await getBalance(seller.id)).pendingTiyin).toBe(0n);
  });
});

describe('§12 — Webhook summasi farq qilsa bloklanadi', () => {
  it('kam pul to\'langan bo\'lsa PAYMENT_MISMATCH', async () => {
    const seller = await makeActor('mis-s');
    const buyer = await makeActor('mis-b');
    const deal = await createDeal(seller, buyer);

    // Xaridor 100 000 o'rniga 50 000 so'm to'laydi
    await fundDeal(deal.id, buyer, { amountTiyin: 5_000_000n });

    const detail = await getDeal(deal.id, buyer);
    expect(detail.body['deal'].status).toBe('PAYMENT_MISMATCH');

    // Pul escrowga YOZILMAYDI — admin hal qilmaguncha
    expect((await getBalance(seller.id)).pendingTiyin).toBe(0n);
  });

  it('ko\'p pul to\'langan bo\'lsa ham PAYMENT_MISMATCH', async () => {
    const seller = await makeActor('mis2-s');
    const buyer = await makeActor('mis2-b');
    const deal = await createDeal(seller, buyer);

    await fundDeal(deal.id, buyer, { amountTiyin: 15_000_000n });

    expect((await getDeal(deal.id, buyer)).body['deal'].status).toBe('PAYMENT_MISMATCH');
    expect((await getBalance(seller.id)).pendingTiyin).toBe(0n);
  });
});

describe('§12 — Ruxsat etilmagan holat o\'tishi rad etiladi', () => {
  it('DRAFT → confirm rad etiladi', async () => {
    const seller = await makeActor('inv-s');
    const buyer = await makeActor('inv-b');
    const deal = await createDeal(seller, buyer);

    const res = await app.inject({
      method: 'POST', url: `/deals/${deal.id}/confirm`, headers: auth(buyer), payload: {},
    });
    expect(res.statusCode).toBe(409);
    expect((res.json() as Record<string, any>).error.code).toBe('INVALID_TRANSITION');
  });

  it('to\'lovsiz jo\'natib bo\'lmaydi', async () => {
    const seller = await makeActor('nos-s');
    const buyer = await makeActor('nos-b');
    const deal = await createDeal(seller, buyer);

    const res = await app.inject({
      method: 'POST', url: `/deals/${deal.id}/ship`, headers: auth(seller),
      payload: { carrier: 'BTS Express', trackingNumber: 'TRK123456' },
    });
    expect(res.statusCode).toBe(409);
  });

  it('sotuvchi tovarni o\'zi tasdiqlay olmaydi', async () => {
    const seller = await makeActor('self-s');
    const buyer = await makeActor('self-b');
    const deal = await createDeal(seller, buyer);
    await fundDeal(deal.id, buyer);
    await app.inject({
      method: 'POST', url: `/deals/${deal.id}/ship`, headers: auth(seller),
      payload: { carrier: 'BTS Express', trackingNumber: 'TRK123456' },
    });

    const res = await app.inject({
      method: 'POST', url: `/deals/${deal.id}/confirm`, headers: auth(seller), payload: {},
    });
    expect(res.statusCode).toBe(403);
    expect((await getBalance(seller.id)).availableTiyin).toBe(0n);
  });
});

describe('§12 — Begona foydalanuvchi savdoni ko\'ra/o\'zgartira olmaydi (IDOR)', () => {
  it('begona savdo 404 qaytaradi (403 emas)', async () => {
    const seller = await makeActor('idor-s');
    const buyer = await makeActor('idor-b');
    const stranger = await makeActor('idor-x');
    const deal = await createDeal(seller, buyer);

    const res = await app.inject({
      method: 'GET', url: `/deals/${deal.id}`, headers: auth(stranger),
    });
    // 403 "bunday savdo bor" degan ma'lumotni oshkor qilardi
    expect(res.statusCode).toBe(404);
  });

  it('begona savdoni o\'zgartira olmaydi', async () => {
    const seller = await makeActor('idor2-s');
    const buyer = await makeActor('idor2-b');
    const stranger = await makeActor('idor2-x');
    const deal = await createDeal(seller, buyer);

    for (const path of ['accept', 'confirm', 'cancel']) {
      const res = await app.inject({
        method: 'POST', url: `/deals/${deal.id}/${path}`, headers: auth(stranger), payload: {},
      });
      expect([403, 404], `${path} → ${res.statusCode}`).toContain(res.statusCode);
    }
  });

  it('begona savdo tarixini ko\'ra olmaydi', async () => {
    const seller = await makeActor('idor3-s');
    const buyer = await makeActor('idor3-b');
    const stranger = await makeActor('idor3-x');
    const deal = await createDeal(seller, buyer);

    const res = await app.inject({
      method: 'GET', url: `/deals/${deal.id}/events`, headers: auth(stranger),
    });
    expect(res.statusCode).toBe(404);
  });

  it('ro\'yxatda faqat o\'z savdolari ko\'rinadi', async () => {
    const seller = await makeActor('list-s');
    const buyer = await makeActor('list-b');
    const stranger = await makeActor('list-x');
    const deal = await createDeal(seller, buyer);

    const res = await app.inject({ method: 'GET', url: '/deals', headers: auth(stranger) });
    const ids = ((res.json() as Record<string, any>)['deals'] as Array<{ id: string }>).map(
      (d) => d.id,
    );
    expect(ids).not.toContain(deal.id);
  });
});

describe('§12 — Nizo ochilgach auto-release timer ISHLAMAYDI', () => {
  it('DISPUTED holatida autoReleaseAt null bo\'ladi', async () => {
    const seller = await makeActor('disp-s');
    const buyer = await makeActor('disp-b');
    const deal = await createDeal(seller, buyer);
    await fundDeal(deal.id, buyer);
    await app.inject({
      method: 'POST', url: `/deals/${deal.id}/ship`, headers: auth(seller),
      payload: { carrier: 'BTS Express', trackingNumber: 'TRK123456' },
    });

    // SHIPPED holatida timer o'rnatilgan
    const shipped = await prisma.deal.findUniqueOrThrow({ where: { id: deal.id } });
    expect(shipped.autoReleaseAt).not.toBeNull();

    const dispute = await app.inject({
      method: 'POST', url: `/deals/${deal.id}/dispute`, headers: auth(buyer),
      payload: { reason: 'Tovar tavsifga umuman mos kelmadi, rasm yubordim' },
    });
    expect(dispute.statusCode, dispute.body).toBe(201);

    // ⚠️ ENG MUHIM TEKSHIRUV: timer O'CHIRILGAN
    const disputed = await prisma.deal.findUniqueOrThrow({ where: { id: deal.id } });
    expect(disputed.status).toBe('DISPUTED');
    expect(disputed.autoReleaseAt).toBeNull();

    // Pul hali ham muzlatilgan holda
    expect((await getBalance(seller.id)).pendingTiyin).toBe(10_000_000n);
    expect((await getBalance(seller.id)).availableTiyin).toBe(0n);
  });

  it('nizo ochilgach ikkala tomon ham confirm qila olmaydi', async () => {
    const seller = await makeActor('disp2-s');
    const buyer = await makeActor('disp2-b');
    const deal = await createDeal(seller, buyer);
    await fundDeal(deal.id, buyer);
    await app.inject({
      method: 'POST', url: `/deals/${deal.id}/ship`, headers: auth(seller),
      payload: { carrier: 'BTS Express', trackingNumber: 'TRK123456' },
    });
    await app.inject({
      method: 'POST', url: `/deals/${deal.id}/dispute`, headers: auth(buyer),
      payload: { reason: 'Tovar buzuq holatda yetib keldi, dalil bor' },
    });

    const res = await app.inject({
      method: 'POST', url: `/deals/${deal.id}/confirm`, headers: auth(buyer), payload: {},
    });
    // Javob tanasi xabarga qo'shiladi: 409 o'rniga boshqa kod kelsa
    // nima uchun kelganini darhol ko'ramiz.
    expect(res.statusCode, `javob: ${res.body}`).toBe(409);
  });
});

describe('§12 — Komissiya tiyingacha aniq', () => {
  it('serverda hisoblanadi, mijozdan kelgan qiymat e\'tiborga olinmaydi', async () => {
    const seller = await makeActor('comm-s');
    const buyer = await makeActor('comm-b');

    const res = await app.inject({
      method: 'POST',
      url: '/deals',
      headers: auth(seller),
      payload: {
        title: 'Test',
        amountTiyin: AMOUNT,
        commissionPayer: 'seller',
        counterpartyEmail: buyer.email,
        myRole: 'seller',
        // Mijoz komissiyani 0 qilmoqchi — e'tiborga olinmasligi kerak
        commissionTiyin: '0',
      },
    });

    expect(res.statusCode).toBe(201);
    const deal = (res.json() as Record<string, any>)['deal'];
    expect(deal.commissionTiyin).toBe('300000'); // 0 emas
  });

  it('toq summada ham yig\'indi aniq chiqadi', async () => {
    const seller = await makeActor('odd-s');
    const buyer = await makeActor('odd-b');
    // 333 300 tiyin = 3 333 so'm (butun so'm — provayder talabi)
    const deal = await createDeal(seller, buyer, '333300');

    await fundDeal(deal.id, buyer);
    await app.inject({
      method: 'POST', url: `/deals/${deal.id}/ship`, headers: auth(seller),
      payload: { carrier: 'BTS Express', trackingNumber: 'TRK123456' },
    });
    await app.inject({
      method: 'POST', url: `/deals/${deal.id}/confirm`, headers: auth(buyer), payload: {},
    });

    const entries = await prisma.ledgerEntry.findMany({ where: { dealId: deal.id } });
    expect(entries.reduce((s, e) => s + e.amount, 0n)).toBe(0n);

    const balance = await getBalance(seller.id);
    // 333 300 * 3% = 9 999 (pastga yaxlitlangan)
    expect(balance.availableTiyin).toBe(333_300n - 9_999n);
  });
});

describe('Savdo yaratish tekshiruvlari', () => {
  it('o\'zi bilan savdo qila olmaydi', async () => {
    const user = await makeActor('self');
    const res = await app.inject({
      method: 'POST', url: '/deals', headers: auth(user),
      payload: {
        title: 'Test', amountTiyin: AMOUNT, counterpartyEmail: user.email, myRole: 'seller',
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it('mavjud bo\'lmagan foydalanuvchi bilan savdo yaratib bo\'lmaydi', async () => {
    const user = await makeActor('nouser');
    const res = await app.inject({
      method: 'POST', url: '/deals', headers: auth(user),
      payload: {
        title: 'Test', amountTiyin: AMOUNT,
        counterpartyEmail: 'yoq@example.com', myRole: 'seller',
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it('juda kichik summani rad etadi', async () => {
    const seller = await makeActor('small-s');
    const buyer = await makeActor('small-b');
    const res = await app.inject({
      method: 'POST', url: '/deals', headers: auth(seller),
      payload: {
        title: 'Test', amountTiyin: '100',
        counterpartyEmail: buyer.email, myRole: 'seller',
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it('tokensiz savdo yaratib bo\'lmaydi', async () => {
    const res = await app.inject({
      method: 'POST', url: '/deals',
      payload: { title: 'Test', amountTiyin: AMOUNT, counterpartyEmail: 'a@b.c', myRole: 'seller' },
    });
    expect(res.statusCode).toBe(401);
  });
});

describe('Idempotency-Key', () => {
  it('bir xil kalit bilan ikkinchi so\'rov yangi savdo yaratmaydi', async () => {
    const seller = await makeActor('idem-s');
    const buyer = await makeActor('idem-b');
    const key = `test-key-${Date.now()}`;
    const payload = {
      title: 'Idempotent test', amountTiyin: AMOUNT,
      commissionPayer: 'seller', counterpartyEmail: buyer.email, myRole: 'seller',
    };

    const first = await app.inject({
      method: 'POST', url: '/deals',
      headers: { ...auth(seller), 'idempotency-key': key },
      payload,
    });
    const second = await app.inject({
      method: 'POST', url: '/deals',
      headers: { ...auth(seller), 'idempotency-key': key },
      payload,
    });

    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(201);

    const firstId = (first.json() as Record<string, any>)['deal'].id;
    const secondId = (second.json() as Record<string, any>)['deal'].id;
    expect(secondId).toBe(firstId); // yangi savdo emas

    const count = await prisma.deal.count({ where: { title: 'Idempotent test', sellerId: seller.id } });
    expect(count).toBe(1);
  });

  it('bir xil kalit + BOSHQA tana → 422', async () => {
    const seller = await makeActor('idem2-s');
    const buyer = await makeActor('idem2-b');
    const key = `test-key2-${Date.now()}`;

    await app.inject({
      method: 'POST', url: '/deals',
      headers: { ...auth(seller), 'idempotency-key': key },
      payload: {
        title: 'Birinchi', amountTiyin: AMOUNT,
        counterpartyEmail: buyer.email, myRole: 'seller',
      },
    });

    const different = await app.inject({
      method: 'POST', url: '/deals',
      headers: { ...auth(seller), 'idempotency-key': key },
      payload: {
        title: 'BOSHQA sarlavha', amountTiyin: AMOUNT,
        counterpartyEmail: buyer.email, myRole: 'seller',
      },
    });

    expect(different.statusCode).toBe(422);
  });
});

describe('Ledger butun test fayli davomida buzilmadi', () => {
  it('umumiy yig\'indi 0', async () => {
    const total = await prisma.ledgerEntry.aggregate({ _sum: { amount: true } });
    expect(total._sum.amount ?? 0n).toBe(0n);
  });

  it('hech kimning available balansi manfiy emas', async () => {
    const negative = await prisma.$queryRaw<Array<{ account_id: string }>>`
      SELECT account_id FROM ledger_entries
       WHERE account_id LIKE 'user:%:available'
       GROUP BY account_id HAVING SUM(amount) < 0
    `;
    expect(negative).toHaveLength(0);
  });
});

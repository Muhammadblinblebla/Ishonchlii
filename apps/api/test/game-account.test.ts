/**
 * O'YIN AKKAUNTI SAVDOSI.
 *
 * Ikki narsani tekshiradi:
 *
 *  1. PUL YO'LI O'ZGARMAGAN — akkaunt savdosida ham escrow, komissiya va
 *     ledger aynan jismoniy tovardagidek ishlaydi.
 *
 *  2. MAXFIY MA'LUMOT SIZMAYDI — login/parol bazaga ochiq yozilmaydi va
 *     xaridordan boshqa hech kimga, to'lovdan oldin esa hech kimga
 *     ko'rinmaydi.
 */

import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/db/prisma.js';
import { getBalance } from '../src/ledger/ledger.service.js';
import { MockPaymentProvider } from '../src/payments/mock.provider.js';
import { setPaymentProvider } from '../src/payments/index.js';
import { decryptSecret, encryptSecret } from '../src/lib/crypto.js';
import { applyBps, COMMISSION_POLICY } from '@escrowuz/shared';
import { cleanupTestUsers, createTestUser, makeApp } from './helpers/setup.js';

let app: FastifyInstance;
let provider: MockPaymentProvider;

const AMOUNT = '10000000'; // 100 000 so'm, tiyinda

/** Siyosatdan hisoblanadi — stavka o'zgarsa test o'zi moslashadi. */
const SELLER_GETS = 10_000_000n - applyBps(10_000_000n, COMMISSION_POLICY.rateBps);

const LOGIN = 'pubg-akkaunt@mail.uz';
const PASSWORD = 'S3cr3t!Parol#2026';

type Actor = Awaited<ReturnType<typeof createTestUser>>;

function auth(actor: Actor): Record<string, string> {
  return { authorization: `Bearer ${actor.token}` };
}

async function createGameDeal(seller: Actor, buyer: Actor) {
  const res = await app.inject({
    method: 'POST',
    url: '/deals',
    headers: auth(seller),
    payload: {
      title: 'PUBG Mobile — Conqueror',
      description: 'Sinov uchun',
      amountTiyin: AMOUNT,
      commissionPayer: 'seller',
      keyword: uniqueKeyword(),
      dealType: 'GAME_ACCOUNT',
    },
  });
  expect(res.statusCode, res.body).toBe(201);
  return (res.json() as Record<string, any>)['deal'];
}

async function fundDeal(dealId: string, buyer: Actor) {
  await app.inject({
    method: 'POST',
    url: `/deals/${dealId}/claim`,
    headers: auth(buyer),
    payload: {},
  });
  const pay = await app.inject({
    method: 'POST',
    url: `/deals/${dealId}/pay`,
    headers: auth(buyer),
    payload: {},
  });
  const invoiceId = (pay.json() as Record<string, any>)['invoiceId'] as string;
  provider.simulatePayment(invoiceId);

  const webhook = provider.buildWebhook(invoiceId);
  const res = await app.inject({
    method: 'POST',
    url: '/webhooks/checkout-uz',
    headers: { ...webhook.headers },
    payload: webhook.body,
  });
  expect(res.statusCode).toBe(200);
}

/**
 * eFootball: sotuvchi "akkauntni topshirdim" deb belgilaydi.
 * Ma'lumotlar CHATDA o'tkaziladi — bu yerda hech narsa yuborilmaydi.
 */
function handover(dealId: string, seller: Actor, overrides: Record<string, unknown> = {}) {
  return app.inject({
    method: 'POST',
    url: `/deals/${dealId}/ship`,
    headers: auth(seller),
    payload: { ...overrides },
  });
}

function uniqueKeyword(): string {
  return `g${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

function sendMessage(dealId: string, actor: Actor, body: string) {
  return app.inject({
    method: 'POST',
    url: `/deals/${dealId}/messages`,
    headers: auth(actor),
    payload: { body },
  });
}

function readMessages(dealId: string, actor: Actor) {
  return app.inject({ method: 'GET', url: `/deals/${dealId}/messages`, headers: auth(actor) });
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

describe('Shifrlash', () => {
  it('shifrlab-ochish asl matnni qaytaradi', () => {
    const original = 'login: pubg@mail.uz\nparol: S3cr3t!Parol#2026';
    expect(decryptSecret(encryptSecret(original))).toBe(original);
  });

  it('bir xil matn har safar BOSHQACHA shifrlanadi', () => {
    // Aks holda bazaga qaragan odam "bu ikki xabar bir xil" degan
    // xulosaga kela olardi.
    expect(encryptSecret('bir xil')).not.toBe(encryptSecret('bir xil'));
  });

  it('o\'zgartirilgan shifrmatn ochilmaydi', () => {
    // GCM butunlikni tekshiradi: buzilgan ma'lumot jimgina chiqmaydi.
    const parts = encryptSecret('asl matn').split('.');
    const data = Buffer.from(parts[3]!, 'base64');
    data[0] = data[0]! ^ 0xff;
    parts[3] = data.toString('base64');

    expect(() => decryptSecret(parts.join('.'))).toThrow();
  });

  it('buzilgan format ochilmaydi', () => {
    expect(() => decryptSecret('shunchaki-matn')).toThrow();
    expect(() => decryptSecret('v9.a.b.c')).toThrow();
  });
});

describe('O\'yin akkaunti savdosi — to\'liq oqim', () => {
  it('yaratish → to\'lov → topshirish → tasdiq, pul to\'g\'ri taqsimlanadi', async () => {
    const seller = await createTestUser('ga-s');
    const buyer = await createTestUser('ga-b');
    const deal = await createGameDeal(seller, buyer);

    expect(deal.dealType).toBe('GAME_ACCOUNT');
    // O'yin nomi server tomonda belgilanadi — hozircha faqat eFootball
    expect(deal.game).toBe('eFootball');

    await fundDeal(deal.id, buyer);

    // Pul escrowda — jismoniy tovardagi bilan AYNAN bir xil summa
    const funded = await getBalance(seller.id);
    expect(funded.pendingTiyin).toBe(10_000_000n);
    expect(funded.availableTiyin).toBe(0n);

    const res = await handover(deal.id, seller, { extra: 'pochta paroli: abc' });
    expect(res.statusCode, res.body).toBe(200);
    expect((res.json() as Record<string, any>)['deal'].status).toBe('SHIPPED');

    const confirm = await app.inject({
      method: 'POST',
      url: `/deals/${deal.id}/confirm`,
      headers: auth(buyer),
      payload: {},
    });
    expect(confirm.statusCode, confirm.body).toBe(200);

    // Komissiya jismoniy tovardagidek ushlanadi — o'yin savdosida
    // pul matematikasi hech qanday farq qilmaydi.
    //
    // Pul `holding` da: savdo tugadi, lekin 30 soat muzlatiladi
    // (WALLET_HOLD_HOURS). `available` faqat fon vazifasi muzlatishni
    // ochgandan keyin to'ladi — bu yerda u ishga tushmaydi.
    const done = await getBalance(seller.id);
    expect(done.holdingTiyin).toBe(SELLER_GETS);
    expect(done.availableTiyin).toBe(0n);
    expect(done.pendingTiyin).toBe(0n);

    // Ledger muvozanati buzilmagan
    const entries = await prisma.ledgerEntry.findMany({ where: { dealId: deal.id } });
    expect(entries.reduce((s, e) => s + e.amount, 0n)).toBe(0n);
  });

  it('auto-release muddati 3 KUN (jismoniy tovarda 7 kun)', async () => {
    const seller = await createTestUser('ga-t-s');
    const buyer = await createTestUser('ga-t-b');
    const deal = await createGameDeal(seller, buyer);
    await fundDeal(deal.id, buyer);
    await handover(deal.id, seller);

    const row = await prisma.deal.findUniqueOrThrow({ where: { id: deal.id } });
    const hours = (row.autoReleaseAt!.getTime() - row.shippedAt!.getTime()) / 3_600_000;
    expect(Math.round(hours)).toBe(72);
  });
});

describe('Chat himoyasi', () => {
  it('TO\'LOVDAN OLDIN chat yopiq', async () => {
    // Ochiq bo'lsa tomonlar platformadan tashqarida kelishib,
    // komissiyasiz savdo qilib ketishardi.
    const seller = await createTestUser('ch-pre-s');
    const buyer = await createTestUser('ch-pre-b');
    const deal = await createGameDeal(seller, buyer);

    const res = await sendMessage(deal.id, seller, 'Salom');
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
  });

  it('to\'lovdan keyin ikkala tomon yozisha oladi', async () => {
    const seller = await createTestUser('ch-ok-s');
    const buyer = await createTestUser('ch-ok-b');
    const deal = await createGameDeal(seller, buyer);
    await fundDeal(deal.id, buyer);

    const a = await sendMessage(deal.id, seller, `login: ${LOGIN}`);
    expect(a.statusCode, a.body).toBe(201);

    const b = await sendMessage(deal.id, buyer, 'Qabul qildim, tekshiryapman');
    expect(b.statusCode, b.body).toBe(201);

    const list = await readMessages(deal.id, buyer);
    expect(list.statusCode).toBe(200);
    const messages = (list.json() as Record<string, any>)['messages'];
    expect(messages).toHaveLength(2);
    expect(messages[0].body).toBe(`login: ${LOGIN}`);
  });

  it('xabar matni bazaga OCHIQ yozilmaydi', async () => {
    const seller = await createTestUser('ch-enc-s');
    const buyer = await createTestUser('ch-enc-b');
    const deal = await createGameDeal(seller, buyer);
    await fundDeal(deal.id, buyer);
    await sendMessage(deal.id, seller, `parol: ${PASSWORD}`);

    const rows = await prisma.message.findMany({ where: { dealId: deal.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.bodyCipher).not.toContain(PASSWORD);
    expect(rows[0]!.bodyCipher.startsWith('v1.')).toBe(true);
  });

  it('BEGONA odam chatni ko\'ra olmaydi', async () => {
    const seller = await createTestUser('ch-x-s');
    const buyer = await createTestUser('ch-x-b');
    const stranger = await createTestUser('ch-x-o');
    const deal = await createGameDeal(seller, buyer);
    await fundDeal(deal.id, buyer);
    await sendMessage(deal.id, seller, `parol: ${PASSWORD}`);

    // 403 emas, 404: savdo mavjudligi ham oshkor qilinmaydi
    const res = await readMessages(deal.id, stranger);
    expect(res.statusCode).toBe(404);
    expect(res.body).not.toContain(PASSWORD);
  });

  it('yozilgan xabarni O\'CHIRIB bo\'lmaydi', async () => {
    // Chat nizoda DALIL — baza triggeri o'chirishni bloklaydi.
    const seller = await createTestUser('ch-del-s');
    const buyer = await createTestUser('ch-del-b');
    const deal = await createGameDeal(seller, buyer);
    await fundDeal(deal.id, buyer);
    await sendMessage(deal.id, seller, 'dalil xabari');

    await expect(
      prisma.message.deleteMany({ where: { dealId: deal.id } }),
    ).rejects.toThrow();
  });

  it('savdo sahifasi javobida xabar matni yo\'q', async () => {
    const seller = await createTestUser('ch-det-s');
    const buyer = await createTestUser('ch-det-b');
    const deal = await createGameDeal(seller, buyer);
    await fundDeal(deal.id, buyer);
    await sendMessage(deal.id, seller, `parol: ${PASSWORD}`);

    for (const actor of [buyer, seller]) {
      const res = await app.inject({
        method: 'GET', url: `/deals/${deal.id}`, headers: auth(actor),
      });
      expect(res.body).not.toContain(PASSWORD);
    }
  });
});

describe('Topshirish qoidalari', () => {
  it('takroriy "topshirdim" ikkinchi marta o\'tmaydi', async () => {
    const seller = await createTestUser('ga-dup-s');
    const buyer = await createTestUser('ga-dup-b');
    const deal = await createGameDeal(seller, buyer);
    await fundDeal(deal.id, buyer);

    const first = await handover(deal.id, seller);
    expect(first.statusCode).toBe(200);

    // SHIPPED holatidan yana "ship" qilib bo'lmaydi
    const second = await handover(deal.id, seller);
    expect(second.statusCode).toBeGreaterThanOrEqual(400);

    const row = await prisma.deal.findUniqueOrThrow({ where: { id: deal.id } });
    expect(row.status).toBe('SHIPPED');
  });

  it('o\'yin savdosiga trek-raqam yuborib bo\'lmaydi', async () => {
    const seller = await createTestUser('ga-mix-s');
    const buyer = await createTestUser('ga-mix-b');
    const deal = await createGameDeal(seller, buyer);
    await fundDeal(deal.id, buyer);

    const res = await app.inject({
      method: 'POST',
      url: `/deals/${deal.id}/ship`,
      headers: auth(seller),
      payload: { carrier: 'BTS Express', trackingNumber: 'BTS123456789' },
    });
    // Login maydonlari yo'q — validatsiya rad etadi
    expect(res.statusCode).toBe(400);

    const row = await prisma.deal.findUniqueOrThrow({ where: { id: deal.id } });
    expect(row.status).toBe('FUNDED');
  });

  it('XARIDOR topshira olmaydi', async () => {
    const seller = await createTestUser('ga-role-s');
    const buyer = await createTestUser('ga-role-b');
    const deal = await createGameDeal(seller, buyer);
    await fundDeal(deal.id, buyer);

    const res = await handover(deal.id, buyer);
    expect(res.statusCode).toBe(403);
  });
});

describe('Jismoniy tovar o\'zgarmagan', () => {
  it('tur ko\'rsatilmasa PHYSICAL bo\'ladi va 7 kun beriladi', async () => {
    const seller = await createTestUser('ph-s');
    const buyer = await createTestUser('ph-b');

    const created = await app.inject({
      method: 'POST',
      url: '/deals',
      headers: auth(seller),
      payload: {
        title: 'Oddiy tovar',
        description: '',
        amountTiyin: AMOUNT,
        commissionPayer: 'seller',
        keyword: uniqueKeyword(),
        // dealType ATAYLAB berilmagan — eski mijozlar shunday yuboradi
      },
    });
    const deal = (created.json() as Record<string, any>)['deal'];
    expect(deal.dealType).toBe('PHYSICAL');
    expect(deal.game).toBeNull();

    await fundDeal(deal.id, buyer);
    await app.inject({
      method: 'POST',
      url: `/deals/${deal.id}/ship`,
      headers: auth(seller),
      payload: { carrier: 'BTS Express', trackingNumber: 'BTS123456789' },
    });

    const row = await prisma.deal.findUniqueOrThrow({ where: { id: deal.id } });
    const hours = (row.autoReleaseAt!.getTime() - row.shippedAt!.getTime()) / 3_600_000;
    expect(Math.round(hours)).toBe(168);
  });

  it('jismoniy savdoga login yuborib bo\'lmaydi', async () => {
    const seller = await createTestUser('ph-mix-s');
    const buyer = await createTestUser('ph-mix-b');

    const created = await app.inject({
      method: 'POST',
      url: '/deals',
      headers: auth(seller),
      payload: {
        title: 'Oddiy tovar',
        description: '',
        amountTiyin: AMOUNT,
        commissionPayer: 'seller',
        keyword: uniqueKeyword(),
        dealType: 'PHYSICAL',
      },
    });
    const deal = (created.json() as Record<string, any>)['deal'];
    await fundDeal(deal.id, buyer);

    const res = await handover(deal.id, seller);
    expect(res.statusCode).toBe(400);
  });

  it('jismoniy savdoda /content ma\'lumot bermaydi', async () => {
    const seller = await createTestUser('ph-cr-s');
    const buyer = await createTestUser('ph-cr-b');

    const created = await app.inject({
      method: 'POST',
      url: '/deals',
      headers: auth(seller),
      payload: {
        title: 'Oddiy tovar',
        description: '',
        amountTiyin: AMOUNT,
        commissionPayer: 'seller',
        keyword: uniqueKeyword(),
        dealType: 'PHYSICAL',
      },
    });
    const deal = (created.json() as Record<string, any>)['deal'];
    await fundDeal(deal.id, buyer);
    await app.inject({
      method: 'POST',
      url: `/deals/${deal.id}/ship`,
      headers: auth(seller),
      payload: { carrier: 'BTS Express', trackingNumber: 'BTS123456789' },
    });

    // Jismoniy savdoda raqamli mahsulot yo'q
    const res = await app.inject({
      method: 'GET', url: `/deals/${deal.id}/content`, headers: auth(buyer),
    });
    expect(res.statusCode).toBe(404);
  });
});

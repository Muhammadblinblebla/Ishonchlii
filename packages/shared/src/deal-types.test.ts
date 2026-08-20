/**
 * Savdo turlari konfiguratsiyasi mantiqan to'g'rimi.
 *
 * Bu testlar bazaga ham, tarmoqqa ham tegmaydi — faqat `deal-types.ts`
 * dagi qiymatlarni tekshiradi. Sababi: bu fayldagi bitta noto'g'ri raqam
 * pulni erta yoki kech o'tkazib yuborishi mumkin.
 */

import { describe, expect, it } from 'vitest';
import {
  BUYER_ACCOUNT_CHECKLIST,
  CHAT_OPEN_STATUSES,
  CREDENTIALS_VISIBLE_STATUSES,
  DEAL_TYPES,
  DEAL_TYPE_RULES,
  KEYWORD_RULES,
  WALLET_HOLD_HOURS,
  chatOpenIn,
  credentialsVisibleIn,
  dealTypeRule,
  isDealType,
  normalizeKeyword,
  usesChat,
  usesContent,
  validateKeyword,
} from './deal-types.js';
import { DEAL_STATUSES, isTerminal } from './deal-status.js';

describe('Savdo turlari', () => {
  it('har bir tur uchun qoida belgilangan', () => {
    for (const type of DEAL_TYPES) {
      expect(DEAL_TYPE_RULES[type], type).toBeDefined();
      expect(DEAL_TYPE_RULES[type].id).toBe(type);
    }
  });

  it('barcha muddatlar musbat butun son', () => {
    for (const type of DEAL_TYPES) {
      const rule = DEAL_TYPE_RULES[type];
      for (const [name, value] of [
        ['autoReleaseHours', rule.autoReleaseHours],
        ['handoverReminderHours', rule.handoverReminderHours],
      ] as const) {
        expect(Number.isInteger(value), `${type}.${name}`).toBe(true);
        expect(value, `${type}.${name}`).toBeGreaterThan(0);
      }
      // `confirmReminderHours` 0 bo'lishi MUMKIN = eslatma yuborilmaydi
      expect(Number.isInteger(rule.confirmReminderHours), type).toBe(true);
      expect(rule.confirmReminderHours, type).toBeGreaterThanOrEqual(0);
    }
  });

  it('ogohlantirish auto-release muddatidan QISQA', () => {
    // Aks holda "pul o'tib ketadi" xabari topshirish bilan bir vaqtda
    // kelardi va hech qanday ogohlantirish vazifasini bajarmasdi.
    for (const type of DEAL_TYPES) {
      const rule = DEAL_TYPE_RULES[type];
      if (rule.confirmReminderHours === 0) continue; // eslatma yo'q
      expect(rule.confirmReminderHours, type).toBeLessThan(rule.autoReleaseHours);
    }
  });

  it('har bir turda tekshirishga kamida 1 soat beriladi', () => {
    // Bundan qisqa muddat xaridorga umuman imkon bermasdi.
    for (const type of DEAL_TYPES) {
      expect(DEAL_TYPE_RULES[type].autoReleaseHours, type).toBeGreaterThanOrEqual(1);
    }
  });

  it('noma\'lum tur eng uzun muddatli (xavfsiz) qoidaga tushadi', () => {
    // Shubhali holatda pul UZOQROQ ushlab turiladi — bu xaridor foydasiga.
    expect(dealTypeRule('ALLAQANDAY_YANGI_TUR').id).toBe('PHYSICAL');
    expect(dealTypeRule(null).id).toBe('PHYSICAL');
    expect(dealTypeRule(undefined).id).toBe('PHYSICAL');
    expect(usesChat('ALLAQANDAY_YANGI_TUR')).toBe(false);
    expect(usesContent('ALLAQANDAY_YANGI_TUR')).toBe(false);
  });

  it('isDealType faqat haqiqiy turlarni qabul qiladi', () => {
    expect(isDealType('GAME_ACCOUNT')).toBe(true);
    expect(isDealType('PHYSICAL')).toBe(true);
    expect(isDealType('game_account')).toBe(false);
    expect(isDealType(null)).toBe(false);
    expect(isDealType(123)).toBe(false);
  });

  it('topshirish usullari to\'g\'ri ajratilgan', () => {
    expect(usesChat('GAME_ACCOUNT')).toBe(true);
    expect(usesContent('GAME_ACCOUNT')).toBe(false);

    expect(usesContent('DIGITAL')).toBe(true);
    expect(usesChat('DIGITAL')).toBe(false);

    expect(usesChat('PHYSICAL')).toBe(false);
    expect(usesContent('PHYSICAL')).toBe(false);
  });

  it('raqamli turlar jismoniy tovardan TEZROQ yakunlanadi', () => {
    // Raqamli topshirish bir zumda bo'ladi — 7 kun kutish ma'nosiz.
    expect(DEAL_TYPE_RULES.GAME_ACCOUNT.autoReleaseHours).toBeLessThan(
      DEAL_TYPE_RULES.PHYSICAL.autoReleaseHours,
    );
    expect(DEAL_TYPE_RULES.DIGITAL.autoReleaseHours).toBeLessThan(
      DEAL_TYPE_RULES.GAME_ACCOUNT.autoReleaseHours,
    );
  });
});

describe('Akkaunt ma\'lumotlarini ko\'rish ruxsati', () => {
  it('pul XARIDORGA qaytgan holatlarda ko\'rsatilmaydi', () => {
    // Pulini qaytarib olgan odam akkauntga ham ega bo'lib qolmasligi kerak —
    // aks holda sotuvchi ham puldan, ham akkauntdan ayriladi.
    expect(credentialsVisibleIn('REFUNDED')).toBe(false);
    expect(credentialsVisibleIn('RESOLVED_BUYER')).toBe(false);
    expect(credentialsVisibleIn('CANCELLED')).toBe(false);
    expect(credentialsVisibleIn('EXPIRED')).toBe(false);
  });

  it('to\'lovdan OLDIN ko\'rsatilmaydi', () => {
    // Eng jiddiy xato bo'lardi: xaridor to'lamasdan akkauntni olib ketardi.
    expect(credentialsVisibleIn('DRAFT')).toBe(false);
    expect(credentialsVisibleIn('AWAITING_PAYMENT')).toBe(false);
    expect(credentialsVisibleIn('FUNDED')).toBe(false);
    expect(credentialsVisibleIn('PAYMENT_MISMATCH')).toBe(false);
  });

  it('topshirilgandan keyin va nizo paytida ko\'rsatiladi', () => {
    expect(credentialsVisibleIn('SHIPPED')).toBe(true);
    expect(credentialsVisibleIn('DELIVERED')).toBe(true);
    expect(credentialsVisibleIn('AUTO_RELEASED')).toBe(true);
    // Nizo paytida ham: xaridor dalil sifatida ko'rsata olishi kerak.
    expect(credentialsVisibleIn('DISPUTED')).toBe(true);
  });

  it('ro\'yxatdagi har bir holat haqiqatda mavjud', () => {
    // Holat nomi o'zgarsa yoki xato yozilsa, ruxsat jimgina yopilib
    // qolardi va xaridor sotib olgan akkauntini ko'ra olmasdi.
    for (const status of CREDENTIALS_VISIBLE_STATUSES) {
      expect(DEAL_STATUSES, status).toContain(status);
    }
  });

  it('ro\'yxatda pul harakatlanmagan hech bir holat yo\'q', () => {
    for (const status of CREDENTIALS_VISIBLE_STATUSES) {
      // Har biri yo SHIPPED/DISPUTED (pul escrowda), yo sotuvchi foydasiga
      // yakunlangan holat bo'lishi kerak.
      const ok =
        status === 'SHIPPED' || status === 'DISPUTED' || isTerminal(status);
      expect(ok, status).toBe(true);
    }
  });
});

describe('Yordamchi ro\'yxatlar', () => {
  it('xaridor ro\'yxatida parol va pochta almashtirish bor', () => {
    // Bu ikkitasi bo'lmasa sotuvchi akkauntni tiklab olishi mumkin —
    // ro'yxatning butun ma'nosi shunda.
    const joined = BUYER_ACCOUNT_CHECKLIST.join(' ').toLowerCase();
    expect(joined).toContain('parol');
    expect(joined).toContain('pochta');
  });

  it('30 soatlik muzlatish mantiqiy', () => {
    // 0 bo'lsa himoya yo'q; juda uzun bo'lsa sotuvchi puliga yetolmaydi.
    expect(WALLET_HOLD_HOURS).toBeGreaterThan(0);
    expect(WALLET_HOLD_HOURS).toBeLessThanOrEqual(72);
  });
});

describe('Kalit so\'z', () => {
  it('to\'g\'ri kalit so\'zni qabul qiladi', () => {
    for (const good of ['efootball', 'pubg-hisob-7', 'my_shop_1', 'Test1234']) {
      const r = validateKeyword(good);
      expect(r.ok, good).toBe(true);
    }
  });

  it('juda qisqa yoki uzun kalit so\'zni rad etadi', () => {
    expect(validateKeyword('ab').ok).toBe(false);
    expect(validateKeyword('a'.repeat(KEYWORD_RULES.maxLength + 1)).ok).toBe(false);
  });

  it('bo\'sh joy va maxsus belgilarni rad etadi', () => {
    // Kalit so'z og'zaki aytiladi va qo'lda yoziladi — bunday belgilar
    // xatoga olib keladi.
    for (const bad of ['salom dunyo', 'test!', 'a@b', 'кирилл', '']) {
      expect(validateKeyword(bad).ok, bad).toBe(false);
    }
  });

  it('KATTA-kichik harf FARQ QILMAYDI', () => {
    // Xaridor "MyShop" deb yozsa ham, "myshop" deb yozsa ham topishi kerak.
    expect(normalizeKeyword('MyShop1')).toBe(normalizeKeyword('myshop1'));
    expect(normalizeKeyword('  EFootball  ')).toBe('efootball');
  });
});

describe('Chat ruxsati', () => {
  it('TO\'LOVDAN OLDIN chat yopiq', () => {
    // Aks holda tomonlar platformadan tashqarida kelishib ketishardi.
    expect(chatOpenIn('DRAFT')).toBe(false);
    expect(chatOpenIn('AWAITING_PAYMENT')).toBe(false);
  });

  it('to\'lovdan keyin va nizo paytida ochiq', () => {
    expect(chatOpenIn('FUNDED')).toBe(true);
    expect(chatOpenIn('SHIPPED')).toBe(true);
    // Nizoda ochiq qoladi — yozishmalar arbitr uchun dalil
    expect(chatOpenIn('DISPUTED')).toBe(true);
  });

  it('savdo yakunlangach yopiladi', () => {
    for (const s of ['DELIVERED', 'AUTO_RELEASED', 'REFUNDED', 'CANCELLED']) {
      expect(chatOpenIn(s), s).toBe(false);
    }
  });

  it('ro\'yxatdagi har bir holat haqiqatda mavjud', () => {
    for (const status of CHAT_OPEN_STATUSES) {
      expect(DEAL_STATUSES, status).toContain(status);
    }
  });
});

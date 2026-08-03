import { describe, expect, it } from 'vitest';
import { COMMISSION_POLICY } from './commission-policy.js';
import {
  MoneyError,
  applyBps,
  computeCommission,
  computePaymentBreakdown,
  distributeFullRefund,
  distributeRefundKeepingCommission,
  distributeSplit,
  formatTiyin,
  parseTiyin,
} from './money.js';

/** 100 000 so'm */
const AMOUNT = 10_000_000n;

describe('applyBps', () => {
  it('3% ni to\'g\'ri hisoblaydi', () => {
    expect(applyBps(10_000_000n, 300)).toBe(300_000n);
  });

  it('pastga yaxlitlaydi', () => {
    // 333 * 3% = 9.99 → 9
    expect(applyBps(333n, 300)).toBe(9n);
  });

  it('manfiy summani rad etadi', () => {
    expect(() => applyBps(-100n, 300)).toThrow(MoneyError);
  });

  it('kasr bps ni rad etadi', () => {
    expect(() => applyBps(100n, 3.5)).toThrow(MoneyError);
  });
});

describe('computePaymentBreakdown — komissiyani kim to\'laydi', () => {
  it('payer=seller: xaridor narxni to\'laydi, sotuvchi narx−komissiya oladi', () => {
    const b = computePaymentBreakdown(AMOUNT, 'seller');

    expect(b.buyerPaysTiyin).toBe(10_000_000n);
    expect(b.sellerReceivesTiyin).toBe(9_700_000n);
    expect(b.commissionTiyin).toBe(300_000n);
  });

  it('payer=buyer: xaridor narx+komissiya to\'laydi, sotuvchi to\'liq oladi', () => {
    const b = computePaymentBreakdown(AMOUNT, 'buyer');

    expect(b.buyerPaysTiyin).toBe(10_300_000n);
    expect(b.sellerReceivesTiyin).toBe(10_000_000n);
    expect(b.commissionTiyin).toBe(300_000n);
  });

  it('payer=split: komissiya teng bo\'linadi', () => {
    const b = computePaymentBreakdown(AMOUNT, 'split');

    expect(b.buyerPaysTiyin).toBe(10_150_000n);
    expect(b.sellerReceivesTiyin).toBe(9_850_000n);
    expect(b.commissionTiyin).toBe(300_000n);
  });

  it('har uch holatda ham: xaridor to\'laydi === sotuvchi oladi + komissiya', () => {
    for (const payer of ['buyer', 'seller', 'split'] as const) {
      const b = computePaymentBreakdown(AMOUNT, payer);
      expect(b.buyerPaysTiyin, payer).toBe(b.sellerReceivesTiyin + b.commissionTiyin);
    }
  });
});

describe('Yaxlitlash — birorta tiyin yo\'qolmaydi (§12)', () => {
  it('toq komissiyada split yig\'indisi aniq chiqadi', () => {
    // 333 333 tiyin * 3% = 9999.99 → 9999 (toq son)
    const b = computePaymentBreakdown(333_333n, 'split');

    expect(b.commissionTiyin).toBe(9_999n);
    // Xaridor ulushi pastga: 9999 * 50% = 4999.5 → 4999
    // Sotuvchi qolganini ko'taradi: 9999 − 4999 = 5000
    expect(b.buyerPaysTiyin).toBe(333_333n + 4_999n);
    expect(b.sellerReceivesTiyin).toBe(333_333n - 5_000n);
    expect(b.buyerPaysTiyin).toBe(b.sellerReceivesTiyin + b.commissionTiyin);
  });

  it('1 tiyindan 10 000 tiyingacha HAR BIR summada muvozanat saqlanadi', () => {
    // Yaxlitlash xatosini tutish uchun keng diapazon bo'ylab yuramiz
    for (let amount = 100_000n; amount <= 100_100n; amount++) {
      for (const payer of ['buyer', 'seller', 'split'] as const) {
        const b = computePaymentBreakdown(amount, payer);
        expect(
          b.buyerPaysTiyin,
          `summa=${amount} payer=${payer}`,
        ).toBe(b.sellerReceivesTiyin + b.commissionTiyin);
        expect(b.sellerReceivesTiyin).toBeGreaterThanOrEqual(0n);
      }
    }
  });

  it('turli komissiya stavkalarida ham muvozanat buzilmaydi', () => {
    for (const bps of [1, 7, 33, 250, 300, 999, 1_234, 5_000]) {
      for (const payer of ['buyer', 'seller', 'split'] as const) {
        const b = computePaymentBreakdown(1_234_567n, payer, bps);
        expect(b.buyerPaysTiyin, `bps=${bps} payer=${payer}`)
          .toBe(b.sellerReceivesTiyin + b.commissionTiyin);
      }
    }
  });
});

describe('distributeSplit — nizo bo\'lib hal qilinganda', () => {
  it('avval komissiya, keyin foizda bo\'linadi (60/40)', () => {
    const d = distributeSplit(10_000_000n, 6_000, 300_000n, true);

    expect(d.toPlatformTiyin).toBe(300_000n);
    expect(d.toBuyerTiyin).toBe(5_820_000n); // 9 700 000 * 60%
    expect(d.toSellerTiyin).toBe(3_880_000n); // 9 700 000 * 40%
  });

  it('yig\'indi HAR DOIM escrow summasiga teng', () => {
    for (const bps of [0, 1, 2_500, 3_333, 5_000, 6_667, 9_999, 10_000]) {
      for (const escrow of [10_000_000n, 333_333n, 1n, 999_999_991n]) {
        const commission = escrow / 33n; // ataylab "chirkin" son
        const d = distributeSplit(escrow, bps, commission, true);
        expect(
          d.toBuyerTiyin + d.toSellerTiyin + d.toPlatformTiyin,
          `escrow=${escrow} bps=${bps}`,
        ).toBe(escrow);
      }
    }
  });

  it('qoldiq tiyin XARIDORGA ketadi (siyosat bo\'yicha)', () => {
    // 7 tiyinni 50/50 bo'lish: 3.5 / 3.5 → sotuvchi 3, xaridor 4
    const d = distributeSplit(7n, 5_000, 0n, false);
    expect(d.toSellerTiyin).toBe(3n);
    expect(d.toBuyerTiyin).toBe(4n); // qoldiq shu yerda
    expect(COMMISSION_POLICY.remainderTo).toBe('buyer');
  });

  it('komissiyasiz variant butun summani bo\'ladi', () => {
    const d = distributeSplit(10_000_000n, 6_000, 300_000n, false);

    expect(d.toPlatformTiyin).toBe(0n);
    expect(d.toBuyerTiyin).toBe(6_000_000n);
    expect(d.toSellerTiyin).toBe(4_000_000n);
  });

  it('100% xaridorga', () => {
    const d = distributeSplit(10_000_000n, 10_000, 300_000n, false);
    expect(d.toBuyerTiyin).toBe(10_000_000n);
    expect(d.toSellerTiyin).toBe(0n);
  });

  it('100% sotuvchiga', () => {
    const d = distributeSplit(10_000_000n, 0, 300_000n, false);
    expect(d.toSellerTiyin).toBe(10_000_000n);
    expect(d.toBuyerTiyin).toBe(0n);
  });

  it('noto\'g\'ri ulushni rad etadi', () => {
    expect(() => distributeSplit(1000n, 10_001, 0n, false)).toThrow(MoneyError);
    expect(() => distributeSplit(1000n, -1, 0n, false)).toThrow(MoneyError);
  });

  it('komissiya escrowdan katta bo\'lsa rad etadi', () => {
    expect(() => distributeSplit(1000n, 5_000, 2000n, true)).toThrow(MoneyError);
  });
});

describe('Qaytarish variantlari', () => {
  it('to\'liq qaytarish — komissiya olinmaydi', () => {
    const d = distributeFullRefund(10_000_000n);
    expect(d.toBuyerTiyin).toBe(10_000_000n);
    expect(d.toPlatformTiyin).toBe(0n);
    expect(d.toSellerTiyin).toBe(0n);
  });

  it('komissiyani ushlab qolgan holda qaytarish', () => {
    const d = distributeRefundKeepingCommission(10_000_000n, 300_000n);
    expect(d.toBuyerTiyin).toBe(9_700_000n);
    expect(d.toPlatformTiyin).toBe(300_000n);
  });

  it('ikkala variantda ham yig\'indi escrowga teng', () => {
    const escrow = 10_000_000n;
    for (const d of [
      distributeFullRefund(escrow),
      distributeRefundKeepingCommission(escrow, 300_000n),
    ]) {
      expect(d.toBuyerTiyin + d.toSellerTiyin + d.toPlatformTiyin).toBe(escrow);
    }
  });
});

describe('Summa chegaralari', () => {
  it('juda kichik savdoni rad etadi', () => {
    expect(() => computePaymentBreakdown(1n, 'seller')).toThrow(MoneyError);
  });

  it('juda katta savdoni rad etadi', () => {
    const tooBig = BigInt(COMMISSION_POLICY.maxDealAmountTiyin) + 1n;
    expect(() => computePaymentBreakdown(tooBig, 'seller')).toThrow(MoneyError);
  });

  it('nol yoki manfiy summani rad etadi', () => {
    expect(() => computeCommission(0n)).toThrow(MoneyError);
    expect(() => computeCommission(-100n)).toThrow(MoneyError);
  });
});

describe('formatTiyin — o\'zbekcha ko\'rinish (§10)', () => {
  it('probel bilan ajratadi', () => {
    // Ajratuvchi — uzunmas probel (U+00A0)
    expect(formatTiyin(10_000_000n).replace(/ /g, ' ')).toBe('100 000 so\'m');
    expect(formatTiyin(100_000_000n).replace(/ /g, ' ')).toBe('1 000 000 so\'m');
  });

  it('tiyin qoldig\'ini ko\'rsatadi', () => {
    // Pul "yo'qolgandek" ko'rinmasligi kerak
    expect(formatTiyin(10_000_050n).replace(/ /g, ' ')).toBe('100 000,50 so\'m');
  });

  it('kichik summalarni to\'g\'ri ko\'rsatadi', () => {
    expect(formatTiyin(100n).replace(/ /g, ' ')).toBe('1 so\'m');
    expect(formatTiyin(1n).replace(/ /g, ' ')).toBe('0,01 so\'m');
  });

  it('valyutasiz variant', () => {
    expect(formatTiyin(10_000_000n, { withCurrency: false }).replace(/ /g, ' ')).toBe('100 000');
  });
});

describe('parseTiyin', () => {
  it('satr, son va bigint qabul qiladi', () => {
    expect(parseTiyin('10000000')).toBe(10_000_000n);
    expect(parseTiyin(10_000_000)).toBe(10_000_000n);
    expect(parseTiyin(10_000_000n)).toBe(10_000_000n);
  });

  it('kasr sonni rad etadi', () => {
    expect(() => parseTiyin(100.5)).toThrow(MoneyError);
  });

  it('matnni rad etadi', () => {
    expect(() => parseTiyin('100 000 so\'m')).toThrow(MoneyError);
    expect(() => parseTiyin('abc')).toThrow(MoneyError);
  });

  it('xavfsiz chegaradan katta sonni rad etadi', () => {
    expect(() => parseTiyin(Number.MAX_SAFE_INTEGER + 2)).toThrow(MoneyError);
  });

  it('juda katta summani SATR sifatida qabul qiladi', () => {
    // Aynan shu sabab summalar API'da satr sifatida yuriladi
    expect(parseTiyin('99999999999999999999')).toBe(99_999_999_999_999_999_999n);
  });
});

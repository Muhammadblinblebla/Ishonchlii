/**
 * NIZONI AVTOMATIK HAL QILISH QOIDALARI.
 *
 * Bu testlar eng muhimlaridan biri: bu yerdagi qoidalar HAQIQIY PULNI
 * odam aralashuvisiz taqsimlaydi. Bitta noto'g'ri shart — va pul
 * noto'g'ri odamga ketadi, hech kim buni sezmaydi.
 */

import { describe, expect, it } from 'vitest';
import {
  DISPUTE_POLICY,
  type DisputeFacts,
  decideDispute,
} from './dispute-policy.js';

/** Barcha faktlar ijobiy — undan keyin kerakligini o'zgartiramiz. */
const ALL: DisputeFacts = {
  sellerMarkedDelivered: true,
  deliveryEvidence: true,
  buyerReceived: true,
};

describe('A — sotuvchi umuman topshirmagan', () => {
  it('pul TO\'LIQ xaridorga qaytadi', () => {
    const d = decideDispute({ ...ALL, sellerMarkedDelivered: false });
    expect(d.resolution).toBe('buyer');
    expect(d.certain).toBe(true);
  });

  it('boshqa faktlardan QAT\'I NAZAR shu qoida ishlaydi', () => {
    // Sotuvchi topshirmagan bo'lsa, qolgan hech narsa ahamiyatsiz.
    for (const evidence of [true, false]) {
      for (const received of [true, false]) {
        const d = decideDispute({
          sellerMarkedDelivered: false,
          deliveryEvidence: evidence,
          buyerReceived: received,
        });
        expect(d.resolution, `${evidence}/${received}`).toBe('buyer');
      }
    }
  });
});

describe('B — "topshirdim" bosilgan, lekin izi yo\'q', () => {
  it('pul TO\'LIQ xaridorga qaytadi', () => {
    // Eng muhim himoya: sotuvchi tugmani bosib, hech narsa yubormasligi
    // va auto-release'ni kutishi mumkin edi.
    const d = decideDispute({ ...ALL, deliveryEvidence: false });
    expect(d.resolution).toBe('buyer');
    expect(d.certain).toBe(true);
  });

  it('xaridor "ko\'rdim" desa ham qoida o\'zgarmaydi', () => {
    const d = decideDispute({
      sellerMarkedDelivered: true,
      deliveryEvidence: false,
      buyerReceived: true,
    });
    expect(d.resolution).toBe('buyer');
  });
});

describe('C — topshirilgan, xaridor ochib ko\'rmagan', () => {
  it('pul sotuvchiga o\'tadi', () => {
    // Ko'rmasdan turib sifatga e'tiroz bildirib bo'lmaydi.
    const d = decideDispute({ ...ALL, buyerReceived: false });
    expect(d.resolution).toBe('seller');
    expect(d.certain).toBe(true);
  });
});

describe('D — ikkalasida ham dalil bor (tizim haqiqatni bilmaydi)', () => {
  it('teng bo\'linadi va TAXMIN deb belgilanadi', () => {
    const d = decideDispute(ALL);
    expect(d.resolution).toBe('split');
    expect(d.buyerShareBps).toBe(DISPUTE_POLICY.contestedBuyerShareBps);
    // ⚠️ `certain: false` — bu qaror faktga emas, qoidaga asoslangan
    expect(d.certain).toBe(false);
  });

  it('bo\'linish TENG (bir tomonni rag\'batlantirmaydi)', () => {
    // Har qanday nomutanosib nisbat bir tomonni yolg'on gapirishga
    // undaydi: "baribir ko'proq olaman" degan hisob paydo bo'ladi.
    expect(DISPUTE_POLICY.contestedBuyerShareBps).toBe(5_000);
  });
});

describe('Qoidalarning umumiy xossalari', () => {
  const ALL_COMBOS: DisputeFacts[] = [];
  for (const a of [true, false])
    for (const b of [true, false])
      for (const c of [true, false])
        ALL_COMBOS.push({
          sellerMarkedDelivered: a,
          deliveryEvidence: b,
          buyerReceived: c,
        });

  it('HAR QANDAY fakt kombinatsiyasida qaror chiqadi', () => {
    // Qaror chiqmasa savdo `DISPUTED` da mangu qolib, pul muzlab qolardi.
    for (const facts of ALL_COMBOS) {
      const d = decideDispute(facts);
      expect(['buyer', 'seller', 'split'], JSON.stringify(facts)).toContain(d.resolution);
      expect(d.reason.length, JSON.stringify(facts)).toBeGreaterThan(10);
    }
  });

  it('faqat BITTA holatda taxmin ishlatiladi', () => {
    // Qolgan hamma holatda qaror aniq faktga asoslanishi kerak.
    const uncertain = ALL_COMBOS.filter((f) => !decideDispute(f).certain);
    expect(uncertain).toHaveLength(1);
    expect(uncertain[0]).toEqual(ALL);
  });

  it('`split` faqat taxminiy qarorda ishlatiladi', () => {
    for (const facts of ALL_COMBOS) {
      const d = decideDispute(facts);
      if (d.resolution === 'split') {
        expect(d.certain, JSON.stringify(facts)).toBe(false);
        expect(d.buyerShareBps).toBeDefined();
      } else {
        expect(d.buyerShareBps, JSON.stringify(facts)).toBeUndefined();
      }
    }
  });

  it('sotuvchi FAQAT haqiqatan topshirganda yutadi', () => {
    // Sotuvchi foydasiga qaror uchun UCHALASI ham kerak: belgilagan,
    // izi bor. Busiz sotuvchi bosish bilan pul olib ketardi.
    for (const facts of ALL_COMBOS) {
      if (decideDispute(facts).resolution === 'seller') {
        expect(facts.sellerMarkedDelivered, JSON.stringify(facts)).toBe(true);
        expect(facts.deliveryEvidence, JSON.stringify(facts)).toBe(true);
      }
    }
  });
});

describe('Kutish muddati', () => {
  it('nizo darhol emas, kutib hal qilinadi', () => {
    // Shu vaqt ichida tomonlar o'zi kelishishi mumkin — ko'p nizo
    // shu bosqichda tizim aralashmasdan yopiladi.
    expect(DISPUTE_POLICY.coolingHours).toBeGreaterThan(0);
  });

  it('kutish muddati juda uzun emas', () => {
    // Uzoq kutish — pul ikkala tomon uchun ham muzlab turishi demak.
    expect(DISPUTE_POLICY.coolingHours).toBeLessThanOrEqual(72);
  });
});

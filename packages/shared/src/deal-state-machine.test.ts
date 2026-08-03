import { describe, expect, it } from 'vitest';
import { DEAL_STATUSES, TERMINAL_STATUSES, isTerminal } from './deal-status.js';
import {
  TRANSITIONS,
  availableActions,
  canTransition,
  checkTransition,
  nextStatus,
  timersActive,
  transitionsFrom,
  type DealAction,
  type DealActor,
} from './deal-state-machine.js';

describe('Ro\'yxatning o\'zi izchil', () => {
  it('barcha o\'tishlar mavjud holatlarni ishlatadi', () => {
    for (const t of TRANSITIONS) {
      expect(DEAL_STATUSES, `from: ${t.from}`).toContain(t.from);
      expect(DEAL_STATUSES, `to: ${t.to}`).toContain(t.to);
    }
  });

  it('yakuniy holatdan CHIQADIGAN o\'tish yo\'q', () => {
    for (const status of TERMINAL_STATUSES) {
      expect(transitionsFrom(status), `${status} dan o'tish bor!`).toHaveLength(0);
    }
  });

  it('bir xil (holat + amal) juftligi ikki marta yozilmagan', () => {
    const seen = new Set<string>();
    for (const t of TRANSITIONS) {
      const key = `${t.from}→${t.action}`;
      expect(seen.has(key), `takrorlangan: ${key}`).toBe(false);
      seen.add(key);
    }
  });

  it('har bir o\'tishda kamida bitta bajaruvchi bor', () => {
    for (const t of TRANSITIONS) {
      expect(t.actors.length, `${t.from}→${t.to}`).toBeGreaterThan(0);
    }
  });

  it('hech bir o\'tish o\'zidan o\'ziga emas', () => {
    for (const t of TRANSITIONS) {
      expect(t.from).not.toBe(t.to);
    }
  });

  it('har bir yakuniy bo\'lmagan holatga yetib borish mumkin', () => {
    const reachable = new Set(TRANSITIONS.map((t) => t.to));
    reachable.add('DRAFT'); // boshlang'ich holat
    for (const status of DEAL_STATUSES) {
      expect(reachable.has(status), `${status} ga yetib bo'lmaydi`).toBe(true);
    }
  });

  it('har bir yakuniy bo\'lmagan holatdan chiqish yo\'li bor', () => {
    // Chiqish yo'li bo'lmasa, savdo o'sha holatda abadiy qotib qoladi
    // va pul muzlagan holda qolaveradi.
    for (const status of DEAL_STATUSES) {
      if (isTerminal(status)) continue;
      expect(transitionsFrom(status).length, `${status} dan chiqib bo'lmaydi`).toBeGreaterThan(0);
    }
  });
});

describe('To\'liq muvaffaqiyatli savdo yo\'li', () => {
  it('DRAFT → AWAITING_PAYMENT → FUNDED → SHIPPED → DELIVERED', () => {
    expect(nextStatus('DRAFT', 'accept', 'buyer')).toBe('AWAITING_PAYMENT');
    expect(nextStatus('AWAITING_PAYMENT', 'pay', 'system')).toBe('FUNDED');
    expect(nextStatus('FUNDED', 'ship', 'seller')).toBe('SHIPPED');
    expect(nextStatus('SHIPPED', 'confirm', 'buyer')).toBe('DELIVERED');
    expect(isTerminal('DELIVERED')).toBe(true);
  });
});

describe('Ruxsat etilmagan o\'tishlar rad etiladi', () => {
  it('DRAFT → DELIVERED mumkin emas (§12)', () => {
    expect(canTransition('DRAFT', 'confirm', 'buyer')).toBe(false);

    const result = checkTransition('DRAFT', 'confirm', 'buyer');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason.code).toBe('NOT_ALLOWED');
  });

  it('to\'lovsiz jo\'natib bo\'lmaydi', () => {
    expect(canTransition('AWAITING_PAYMENT', 'ship', 'seller')).toBe(false);
  });

  it('jo\'natilmagan tovarni tasdiqlab bo\'lmaydi', () => {
    expect(canTransition('FUNDED', 'confirm', 'buyer')).toBe(false);
  });

  it('yakuniy holatdan hech qanday amal bajarib bo\'lmaydi', () => {
    const allActions: DealAction[] = [
      'accept', 'pay', 'ship', 'confirm', 'cancel', 'refund', 'expire',
      'auto_release', 'dispute', 'resolve_buyer', 'resolve_seller',
      'resolve_split', 'flag_mismatch', 'mismatch_accept', 'mismatch_refund',
    ];
    const allActors: DealActor[] = ['buyer', 'seller', 'admin', 'system'];

    for (const status of TERMINAL_STATUSES) {
      for (const action of allActions) {
        for (const actor of allActors) {
          const result = checkTransition(status, action, actor);
          expect(result.ok, `${status} + ${action} + ${actor} o'tib ketdi!`).toBe(false);
          if (!result.ok) expect(result.reason.code).toBe('TERMINAL');
        }
      }
    }
  });
});

describe('Rollar tekshiriladi (§2)', () => {
  it('faqat xaridor shartlarni qabul qila oladi', () => {
    expect(canTransition('DRAFT', 'accept', 'buyer')).toBe(true);
    expect(canTransition('DRAFT', 'accept', 'seller')).toBe(false);
    expect(canTransition('DRAFT', 'accept', 'admin')).toBe(false);
  });

  it('faqat sotuvchi trek-raqam kirita oladi', () => {
    expect(canTransition('FUNDED', 'ship', 'seller')).toBe(true);
    expect(canTransition('FUNDED', 'ship', 'buyer')).toBe(false);
  });

  it('faqat xaridor tovarni tasdiqlay oladi', () => {
    expect(canTransition('SHIPPED', 'confirm', 'buyer')).toBe(true);
    expect(canTransition('SHIPPED', 'confirm', 'seller')).toBe(false);
    // Admin ham tasdiqlay olmaydi — §2: admin faqat nizoga aralashadi
    expect(canTransition('SHIPPED', 'confirm', 'admin')).toBe(false);
  });

  it('to\'lovni faqat tizim (webhook) qayd eta oladi', () => {
    expect(canTransition('AWAITING_PAYMENT', 'pay', 'system')).toBe(true);
    // Xaridor "to'ladim" deb o'zi bosib qo'ya olmaydi
    expect(canTransition('AWAITING_PAYMENT', 'pay', 'buyer')).toBe(false);
  });

  it('nizoni faqat admin hal qila oladi', () => {
    for (const action of ['resolve_buyer', 'resolve_seller', 'resolve_split'] as const) {
      expect(canTransition('DISPUTED', action, 'admin')).toBe(true);
      expect(canTransition('DISPUTED', action, 'buyer')).toBe(false);
      expect(canTransition('DISPUTED', action, 'seller')).toBe(false);
      expect(canTransition('DISPUTED', action, 'system')).toBe(false);
    }
  });

  it('admin oddiy savdoga aralasha olmaydi (§2)', () => {
    // Admin FAQAT nizo va to'lov nomuvofiqligi holatlarida ishtirok etadi
    const adminActions = new Set(
      TRANSITIONS.filter((t) => t.actors.includes('admin')).map((t) => t.from),
    );
    expect([...adminActions].sort()).toEqual(['DISPUTED', 'PAYMENT_MISMATCH']);
  });

  it('ikkala tomon ham nizo ocha oladi (§7)', () => {
    for (const from of ['FUNDED', 'SHIPPED'] as const) {
      expect(canTransition(from, 'dispute', 'buyer')).toBe(true);
      expect(canTransition(from, 'dispute', 'seller')).toBe(true);
    }
  });

  it('noto\'g\'ri bajaruvchi WRONG_ACTOR sababini beradi', () => {
    const result = checkTransition('FUNDED', 'ship', 'buyer');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason.code).toBe('WRONG_ACTOR');
  });
});

describe('NIZO — timerlar to\'xtashi (§7, §12)', () => {
  it('DISPUTED dan auto_release ga o\'tish YO\'Q', () => {
    // Bu tizimning eng muhim testi: nizo ochilgan bo'lsa ham timeout
    // ishlab, pulni sotuvchiga o'tkazib yuborish — klassik escrow xatosi.
    expect(canTransition('DISPUTED', 'auto_release', 'system')).toBe(false);

    const autoReleaseSources = TRANSITIONS
      .filter((t) => t.action === 'auto_release')
      .map((t) => t.from);
    expect(autoReleaseSources).toEqual(['SHIPPED']);
  });

  it('DISPUTED holatida timerlar o\'chiq', () => {
    expect(timersActive('DISPUTED')).toBe(false);
  });

  it('DISPUTED dan expire ham ishlamaydi', () => {
    expect(canTransition('DISPUTED', 'expire', 'system')).toBe(false);
  });

  it('SHIPPED holatida timerlar ishlaydi', () => {
    expect(timersActive('SHIPPED')).toBe(true);
    expect(canTransition('SHIPPED', 'auto_release', 'system')).toBe(true);
  });

  it('barcha yakuniy holatlarda timerlar o\'chiq', () => {
    for (const status of TERMINAL_STATUSES) {
      expect(timersActive(status), status).toBe(false);
    }
  });

  it('PAYMENT_MISMATCH holatida ham timerlar o\'chiq', () => {
    // Admin qo'lda hal qiladi — avtomatik hech narsa bo'lmasligi kerak
    expect(timersActive('PAYMENT_MISMATCH')).toBe(false);
  });

  it('DISPUTED dan faqat admin qarorlari chiqadi', () => {
    const actions = transitionsFrom('DISPUTED').map((t) => t.action).sort();
    expect(actions).toEqual(['resolve_buyer', 'resolve_seller', 'resolve_split']);
  });
});

describe('availableActions — frontend uchun', () => {
  it('SHIPPED holatida xaridor tasdiqlashi yoki nizo ochishi mumkin', () => {
    expect([...availableActions('SHIPPED', 'buyer')].sort()).toEqual(['confirm', 'dispute']);
  });

  it('SHIPPED holatida sotuvchi faqat nizo ocha oladi', () => {
    expect([...availableActions('SHIPPED', 'seller')]).toEqual(['dispute']);
  });

  it('yakuniy holatda hech kimga amal yo\'q', () => {
    for (const actor of ['buyer', 'seller', 'admin', 'system'] as const) {
      expect(availableActions('DELIVERED', actor)).toHaveLength(0);
    }
  });

  it('FUNDED holatida xaridor jo\'nata olmaydi', () => {
    expect(availableActions('FUNDED', 'buyer')).not.toContain('ship');
  });
});

describe('To\'lov nomuvofiqligi (§5)', () => {
  it('AWAITING_PAYMENT dan PAYMENT_MISMATCH ga o\'tadi', () => {
    expect(nextStatus('AWAITING_PAYMENT', 'flag_mismatch', 'system')).toBe('PAYMENT_MISMATCH');
  });

  it('PAYMENT_MISMATCH yakuniy emas — admin hal qiladi', () => {
    expect(isTerminal('PAYMENT_MISMATCH')).toBe(false);
    expect(transitionsFrom('PAYMENT_MISMATCH').length).toBeGreaterThan(0);
  });

  it('PAYMENT_MISMATCH dan faqat admin chiqara oladi', () => {
    for (const t of transitionsFrom('PAYMENT_MISMATCH')) {
      expect(t.actors).toEqual(['admin']);
    }
  });
});

/**
 * XABARNOMA MATNLARI.
 *
 * Barchasi shu yerda — kodga yozilmaydi. Har biri ikki qismdan iborat:
 * sarlavha va matn. Matn ODDIY tilda, texnik atamalarsiz yoziladi:
 * odam emailni ochganda nima bo'lganini va nima qilishi kerakligini
 * darhol tushunishi kerak.
 *
 * Har bir xabarda ANIQ bitta harakat bo'ladi — "nima qilay?" degan savol
 * qolmasin.
 */

import { type DealType, WALLET_HOLD_HOURS, dealTypeRule } from '../deal-types.js';

export interface EmailContent {
  readonly subject: string;
  readonly heading: string;
  readonly body: string;
  /** Tugma matni. `null` bo'lsa tugma ko'rsatilmaydi. */
  readonly action: string | null;
}

export interface EmailContext {
  /** Qabul qiluvchining ismi. */
  readonly name: string;
  readonly dealTitle: string;
  /** Formatlangan summa: "100 000 so'm". */
  readonly amount: string;
  /** Qarshi tomonning ismi. */
  readonly counterparty?: string;
  readonly trackingNumber?: string;
  readonly carrier?: string;
  readonly reason?: string;
  /** Auto-release ogohlantirishi uchun. */
  readonly daysLeft?: number;
  /**
   * Savdo turi. O'yin akkauntida "tovar yuborish" haqida gapirish noto'g'ri —
   * hech narsa yuborilmaydi, login topshiriladi.
   */
  readonly dealType?: DealType;
}

export type EmailTemplate =
  | 'deal.invited'
  | 'deal.accepted'
  | 'deal.funded.seller'
  | 'deal.funded.buyer'
  | 'deal.shipped'
  | 'deal.confirmed.seller'
  | 'deal.auto_released.seller'
  | 'deal.auto_released.buyer'
  | 'deal.cancelled'
  | 'deal.refunded'
  | 'deal.expired'
  | 'dispute.opened'
  | 'dispute.resolved'
  | 'payment.mismatch'
  | 'reminder.ship'
  | 'reminder.confirm'
  | 'reminder.dispute.admin';

export function renderEmail(template: EmailTemplate, ctx: EmailContext): EmailContent {
  const deal = `«${ctx.dealTitle}»`;
  const rule = dealTypeRule(ctx.dealType);
  // Uch xil topshirish usuli — matnlar har biriga moslashadi.
  const viaChat = rule.handover === 'chat';       // eFootball akkaunt
  const viaContent = rule.handover === 'content'; // PDF/video/havola/matn
  const digital = viaChat || viaContent;          // ikkalasi ham pochtasiz
  const autoReleaseDays = Math.round(rule.autoReleaseHours / 24);

  switch (template) {
    case 'deal.invited':
      return {
        subject: `Sizga savdo taklif qilindi — ${ctx.dealTitle}`,
        heading: 'Sizga savdo taklif qilindi',
        body:
          `${ctx.counterparty ?? 'Hamkoringiz'} siz bilan ${deal} savdosini ochdi. ` +
          `Summa: ${ctx.amount}.\n\n` +
          `Shartlarni ko'rib chiqing. Rozi bo'lsangiz qabul qiling — keyin pulni ` +
          `platformaga tushirasiz va u siz tovarni olganingizni tasdiqlaguningizcha ` +
          `saqlanadi.`,
        action: 'Savdoni ko\'rish',
      };

    case 'deal.accepted':
      return {
        subject: `Shartlar qabul qilindi — ${ctx.dealTitle}`,
        heading: 'Xaridor shartlarni qabul qildi',
        body:
          `${deal} savdosi bo'yicha xaridor rozi bo'ldi. Endi u to'lov qilishi kerak.\n\n` +
          `To'lov kelgach sizga xabar beramiz va tovarni yuborishingiz mumkin bo'ladi. ` +
          `Undan oldin hech narsa yubormang.`,
        action: 'Savdoni ko\'rish',
      };

    case 'deal.funded.seller':
      if (viaChat) {
        return {
          subject: `Pul keldi — akkauntni topshiring — ${ctx.dealTitle}`,
          heading: 'To\'lov qabul qilindi',
          body:
            `${deal} savdosi bo'yicha ${ctx.amount} platformaga tushdi va saqlanmoqda.\n\n` +
            `Saytda xaridor bilan CHAT ochildi. Akkaunt ma'lumotlarini o'sha yerda ` +
            `yuboring — yozishmalar shifrlangan va nizo chiqsa dalil bo'ladi.\n\n` +
            `Pul xaridor "Akkaunt nomimga o'tdi" tugmasini bosgach hisobingizga o'tadi. ` +
            `Xaridor ${autoReleaseDays} kun ichida javob bermasa — pul avtomatik sizga o'tadi.`,
          action: 'Chatni ochish',
        };
      }
      if (viaContent) {
        return {
          subject: `Pul keldi — mahsulotni topshiring — ${ctx.dealTitle}`,
          heading: 'To\'lov qabul qilindi',
          body:
            `${deal} savdosi bo'yicha ${ctx.amount} platformaga tushdi va saqlanmoqda.\n\n` +
            `Endi saytga kirib mahsulotni topshiring: havola, matn yoki fayl. ` +
            `U shifrlangan holda saqlanadi va faqat xaridor ko'radi.\n\n` +
            `Xaridor tekshirib tasdiqlagach pul hisobingizga o'tadi.`,
          action: 'Mahsulotni topshirish',
        };
      }
      return {
        subject: `Pul keldi — tovarni yuboring — ${ctx.dealTitle}`,
        heading: 'To\'lov qabul qilindi',
        body:
          `${deal} savdosi bo'yicha ${ctx.amount} platformaga tushdi va saqlanmoqda.\n\n` +
          `Endi tovarni yuborishingiz mumkin. Yuborganingizdan keyin saytga kirib ` +
          `trek-raqamni kiriting — xaridor buni ko'radi.\n\n` +
          `Pul xaridor tovarni olganini tasdiqlagach hisobingizga o'tadi.`,
        action: 'Trek-raqam kiritish',
      };

    case 'deal.funded.buyer':
      return {
        subject: `To'lovingiz qabul qilindi — ${ctx.dealTitle}`,
        heading: 'To\'lov qabul qilindi',
        body:
          `${ctx.amount} platformada saqlanmoqda. Sotuvchi unga hali tegolmaydi.\n\n` +
          (viaChat
            ? `Sotuvchi bilan CHAT ochildi — akkauntni o'sha yerda o'tkazasiz.`
            : viaContent
              ? `Endi sotuvchi mahsulotni topshiradi. U topshirgach sizga xabar beramiz.`
              : `Endi sotuvchi tovarni yuboradi. U trek-raqam kiritgach sizga xabar beramiz.`),
        action: 'Savdoni ko\'rish',
      };

    case 'deal.shipped':
      if (viaChat) {
        return {
          subject: `Akkaunt topshirildi — ${ctx.dealTitle}`,
          heading: 'Sotuvchi akkauntni topshirdi',
          body:
            `${deal} bo'yicha sotuvchi akkauntni topshirdi. Chatni oching va ` +
            `ma'lumotlarni ko'ring.\n\n` +
            `DARHOL shularni qiling:\n` +
            `  1. Akkauntga kiring va hamma narsa joyidaligini tekshiring\n` +
            `  2. Parolni o'zingiznikiga almashtiring\n` +
            `  3. Bog'langan pochta va telefonni o'zingiznikiga almashtiring\n` +
            `  4. Ikki bosqichli himoyani yoqing\n\n` +
            `Shundan keyingina "Akkaunt nomimga o'tdi" tugmasini bosing — ` +
            `bosgach pul sotuvchiga o'tadi.\n\n` +
            `Muammo bo'lsa nizo oching: pul muzlatilgan holda qoladi. ` +
            `${autoReleaseDays} kun ichida javob bermasangiz pul avtomatik sotuvchiga o'tadi.`,
          action: 'Chatni ochish',
        };
      }
      if (viaContent) {
        return {
          subject: `⏰ Mahsulot tayyor — 1 SOAT ichida tekshiring — ${ctx.dealTitle}`,
          heading: 'Mahsulot topshirildi',
          body:
            `${deal} bo'yicha mahsulot tayyor. Saytga kirib oching.\n\n` +
            `⏰ DIQQAT: sizda tekshirish uchun ${rule.autoReleaseHours} SOAT bor.\n` +
            `Shu vaqt ichida javob bermasangiz pul AVTOMATIK sotuvchiga o'tadi.\n\n` +
            `Hoziroq oching va tekshiring:\n` +
            `  • havola ochiladimi\n` +
            `  • fayl to'liq yuklanadimi\n` +
            `  • ichidagi narsa savdoda yozilganidek mi\n\n` +
            `Hammasi joyida bo'lsa "Mahsulotni tekshirdim" tugmasini bosing.\n` +
            `Muammo bo'lsa DARHOL nizo oching — pul muzlatilgan holda qoladi.`,
          action: 'Mahsulotni ochish',
        };
      }
      return {
        subject: `Tovar yuborildi — ${ctx.dealTitle}`,
        heading: 'Sotuvchi tovarni yubordi',
        body:
          `${deal} bo'yicha tovar yo'lga chiqdi.\n\n` +
          (ctx.carrier && ctx.trackingNumber
            ? `Yetkazuvchi: ${ctx.carrier}\nTrek-raqam: ${ctx.trackingNumber}\n\n`
            : '') +
          `Tovar yetib borgach tekshiring. Hammasi joyida bo'lsa saytga kirib ` +
          `tasdiqlang — shundan keyin pul sotuvchiga o'tadi.\n\n` +
          `Muammo bo'lsa nizo oching: pul muzlatilgan holda qoladi va ` +
          `mustaqil arbitr ko'rib chiqadi.`,
        action: 'Tovarni tasdiqlash',
      };

    case 'deal.confirmed.seller':
      return {
        subject: `Pul hisobingizga o'tdi — ${ctx.dealTitle}`,
        heading: 'Savdo muvaffaqiyatli yakunlandi',
        body:
          `Xaridor tasdiqladi. ${ctx.amount} hisobingizga o'tkazildi.\n\n` +
          `⏳ Pul ${WALLET_HOLD_HOURS} soat MUZLATILGAN holda turadi — bu xavfsizlik ` +
          `muddati. Muddat tugagach avtomatik ravishda yechib olish mumkin bo'ladi.\n\n` +
          `Qolgan vaqtni hamyon bo'limida ko'rasiz.`,
        action: 'Hamyonni ochish',
      };

    case 'deal.auto_released.seller':
      return {
        subject: `Savdo avtomatik yakunlandi — ${ctx.dealTitle}`,
        heading: 'Savdo avtomatik yakunlandi',
        body:
          `Xaridor belgilangan muddatda javob bermadi, shuning uchun savdo ` +
          `avtomatik yakunlandi. ${ctx.amount} hisobingizga o'tkazildi.`,
        action: 'Hamyonni ochish',
      };

    case 'deal.auto_released.buyer':
      return {
        subject: `Savdo avtomatik yakunlandi — ${ctx.dealTitle}`,
        heading: 'Savdo avtomatik yakunlandi',
        body:
          `${deal} bo'yicha ${autoReleaseDays} kun ichida tasdiqlash ham, nizo ham ` +
          `bo'lmadi. Shartlarga muvofiq pul sotuvchiga o'tkazildi.\n\n` +
          `Agar muammo bo'lsa — biz bilan bog'laning.`,
        action: null,
      };

    case 'deal.cancelled':
      return {
        subject: `Savdo bekor qilindi — ${ctx.dealTitle}`,
        heading: 'Savdo bekor qilindi',
        body:
          `${deal} savdosi bekor qilindi.` +
          (ctx.reason ? `\n\nSabab: ${ctx.reason}` : '') +
          `\n\nPul tushmagan edi, shuning uchun hech narsa yechilmagan.`,
        action: null,
      };

    case 'deal.refunded':
      return {
        subject: `Pulingiz qaytarildi — ${ctx.dealTitle}`,
        heading: 'Pul qaytarildi',
        body:
          `${deal} savdosi yakunlanmadi va ${ctx.amount} hisobingizga qaytarildi.` +
          (ctx.reason ? `\n\nSabab: ${ctx.reason}` : '') +
          `\n\nSummani hamyondan yechib olishingiz yoki boshqa savdoda ishlatishingiz mumkin.`,
        action: 'Hamyonni ochish',
      };

    case 'deal.expired':
      return {
        subject: `To'lov muddati o'tdi — ${ctx.dealTitle}`,
        heading: 'Savdo yopildi',
        body:
          `${deal} savdosi bo'yicha to'lov belgilangan muddatda amalga oshirilmadi, ` +
          `shuning uchun savdo yopildi.\n\n` +
          `Pul tushmagan — hech narsa yechilmagan. Kerak bo'lsa yangi savdo yarating.`,
        action: null,
      };

    case 'dispute.opened':
      return {
        subject: `Nizo ochildi — ${ctx.dealTitle}`,
        heading: 'Nizo ochildi',
        body:
          `${deal} savdosi bo'yicha nizo ochildi. Pul muzlatilgan holda qoldi — ` +
          `hech kimga o'tmaydi.\n\n` +
          (ctx.reason ? `Ko'rsatilgan sabab:\n${ctx.reason}\n\n` : '') +
          `Mustaqil arbitr ikkala tomonni ko'rib chiqib qaror qabul qiladi. ` +
          `Sizda dalil bo'lsa (rasm, yozishmalar, chek) — tayyorlab qo'ying.`,
        action: 'Savdoni ko\'rish',
      };

    case 'dispute.resolved':
      return {
        subject: `Nizo hal qilindi — ${ctx.dealTitle}`,
        heading: 'Nizo bo\'yicha qaror qabul qilindi',
        body:
          `${deal} savdosi bo'yicha qaror qabul qilindi.\n\n` +
          (ctx.reason ? `Qaror sababi:\n${ctx.reason}\n\n` : '') +
          `Savdo sahifasida pul qanday taqsimlanganini to'liq ko'rishingiz mumkin.`,
        action: 'Savdoni ko\'rish',
      };

    case 'payment.mismatch':
      return {
        subject: `To'lov tekshirilmoqda — ${ctx.dealTitle}`,
        heading: 'To\'lovingiz tekshirilmoqda',
        body:
          `${deal} savdosi bo'yicha kelgan summa savdodagi summadan farq qildi.\n\n` +
          `Pul xavfsiz saqlanmoqda. Administrator qo'lda tekshirmoqda va tez orada ` +
          `javob beramiz. Sizdan hech narsa talab qilinmaydi.`,
        action: null,
      };

    case 'reminder.ship': {
      const what = viaChat ? 'akkauntni' : viaContent ? 'mahsulotni' : 'tovarni';
      const hours = rule.handoverReminderHours;
      const waited = hours >= 24 ? `${Math.round(hours / 24)} kundan` : `${hours} soatdan`;

      if (digital) {
        return {
          subject: `Eslatma: ${what} topshirish kerak — ${ctx.dealTitle}`,
          heading: `Topshirishni unutmang`,
          body:
            `${deal} savdosi bo'yicha pul ${waited} beri platformada kutmoqda, ` +
            `lekin ${what} hali topshirilmagan.\n\n` +
            (viaChat
              ? `Chatni oching va akkaunt ma'lumotlarini yuboring.`
              : `Saytga kirib havola, matn yoki faylni yuklang.`) +
            `\n\nTopshira olmayotgan bo'lsangiz — savdoni bekor qiling, ` +
            `pul xaridorga qaytadi.`,
          action: viaChat ? 'Chatni ochish' : 'Mahsulotni topshirish',
        };
      }
      return {
        subject: `Eslatma: tovarni yuborish kerak — ${ctx.dealTitle}`,
        heading: 'Tovarni yuborishni unutmang',
        body:
          `${deal} savdosi bo'yicha pul ${waited} beri platformada kutmoqda, ` +
          `lekin trek-raqam hali kiritilmagan.\n\n` +
          `Tovarni yuborgan bo'lsangiz — saytga kirib trek-raqamni kiriting. ` +
          `Yubora olmayotgan bo'lsangiz — savdoni bekor qiling, pul xaridorga qaytadi.`,
        action: 'Trek-raqam kiritish',
      };
    }

    case 'reminder.confirm': {
      const days = ctx.daysLeft ?? Math.max(1, autoReleaseDays);
      const what = viaChat ? 'Akkauntni' : viaContent ? 'Mahsulotni' : 'Tovarni';

      return {
        subject: `${days} kundan keyin pul avtomatik o'tadi — ${ctx.dealTitle}`,
        heading: `${what} tasdiqlashni unutmang`,
        body:
          `${deal} savdosi bo'yicha sotuvchi o'z qismini bajargan edi.\n\n` +
          `Agar ${days} kun ichida javob bermasangiz, pul avtomatik ` +
          `sotuvchiga o'tkaziladi.\n\n` +
          (viaChat
            ? `Akkauntga kirgan, parol va pochtani o'zingiznikiga almashtirgan ` +
              `bo'lsangiz — tasdiqlang.`
            : viaContent
              ? `Mahsulotni ochib ko'rgan va hammasi joyida bo'lsa — tasdiqlang.`
              : `Tovar yetib kelgan va hammasi joyida bo'lsa — tasdiqlang.`) +
          `\n\nMuammo bo'lsa — darhol nizo oching, shunda pul muzlatilgan holda qoladi.`,
        action: 'Savdoni ochish',
      };
    }

    case 'reminder.dispute.admin':
      return {
        subject: `Hal qilinmagan nizo — ${ctx.dealTitle}`,
        heading: 'Nizo 24 soatdan beri kutmoqda',
        body:
          `${deal} savdosi bo'yicha nizo hal qilinmagan. Summa: ${ctx.amount}.\n\n` +
          `Pul muzlatilgan holda turibdi — ikkala tomon ham kutmoqda.`,
        action: 'Nizolarni ko\'rish',
      };
  }
}

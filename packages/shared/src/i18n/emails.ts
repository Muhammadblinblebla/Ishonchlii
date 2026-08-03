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
          `Endi sotuvchi tovarni yuboradi. U trek-raqam kiritgach sizga xabar beramiz.`,
        action: 'Savdoni ko\'rish',
      };

    case 'deal.shipped':
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
          `Xaridor tovarni olganini tasdiqladi. ${ctx.amount} hisobingizga o'tkazildi.\n\n` +
          `Uni hamyon bo'limidan yechib olishingiz mumkin.`,
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
          `${deal} bo'yicha 7 kun ichida tasdiqlash ham, nizo ham bo'lmadi. ` +
          `Shartlarga muvofiq pul sotuvchiga o'tkazildi.\n\n` +
          `Agar tovarda muammo bo'lsa — biz bilan bog'laning.`,
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

    case 'reminder.ship':
      return {
        subject: `Eslatma: tovarni yuborish kerak — ${ctx.dealTitle}`,
        heading: 'Tovarni yuborishni unutmang',
        body:
          `${deal} savdosi bo'yicha pul 3 kundan beri platformada kutmoqda, ` +
          `lekin trek-raqam hali kiritilmagan.\n\n` +
          `Tovarni yuborgan bo'lsangiz — saytga kirib trek-raqamni kiriting. ` +
          `Yubora olmayotgan bo'lsangiz — savdoni bekor qiling, pul xaridorga qaytadi.`,
        action: 'Trek-raqam kiritish',
      };

    case 'reminder.confirm':
      return {
        subject: `${ctx.daysLeft ?? 3} kundan keyin pul avtomatik o'tadi — ${ctx.dealTitle}`,
        heading: 'Tovarni tasdiqlashni unutmang',
        body:
          `${deal} savdosi bo'yicha tovar yuborilgan edi.\n\n` +
          `Agar ${ctx.daysLeft ?? 3} kun ichida javob bermasangiz, pul avtomatik ` +
          `sotuvchiga o'tkaziladi.\n\n` +
          `Tovar yetib kelgan va hammasi joyida bo'lsa — tasdiqlang. ` +
          `Yetib kelmagan yoki muammo bo'lsa — darhol nizo oching, ` +
          `shunda pul muzlatilgan holda qoladi.`,
        action: 'Savdoni ochish',
      };

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

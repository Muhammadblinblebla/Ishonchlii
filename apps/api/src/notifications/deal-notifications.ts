/**
 * Savdo o'tishlarida kimga qanday xabar ketishini belgilaydi.
 *
 * Bu yerda FAQAT "kim + qaysi shablon" qarori bor. Matnlar
 * `packages/shared/src/i18n/emails.ts` da, yuborish esa fon vazifasida.
 *
 * Qoida: har bir o'tishda HARAKAT KUTILAYOTGAN tomonga xabar boradi.
 * Ikkala tomonga ham yuborish kerak bo'lsa — ikkitasi qo'shiladi.
 */

import type { Deal, Prisma } from '@prisma/client';
import { formatTiyin, type DealStatus, type EmailTemplate } from '@escrowuz/shared';
import { escrowAmountOf } from '../deals/transition.js';
import { enqueueMany, type EnqueueParams } from './notification.service.js';

interface NotifyParams {
  readonly deal: Deal;
  readonly from: DealStatus;
  readonly to: DealStatus;
  /** Savdo versiyasi — dedupe kaliti uchun, har o'tish uchun noyob. */
  readonly version: number;
  readonly reason?: string | undefined;
  readonly shipment?: { carrier: string; trackingNumber: string } | undefined;
}

/**
 * O'tishga mos xabarnomalarni navbatga qo'yadi.
 *
 * `executeTransition` ichidan, tranzaksiya bilan birga chaqiriladi.
 */
export async function notifyTransition(
  params: NotifyParams,
  tx: Prisma.TransactionClient,
): Promise<void> {
  const { deal, to, version } = params;

  const amount = formatTiyin(escrowAmountOf(deal));
  // `dealType` har bir xabarga qo'shiladi: o'yin akkauntida "tovar yuborish"
  // haqida gapirish xaridorni chalkashtiradi — hech narsa yuborilmaydi.
  const base = { dealTitle: deal.title, amount, dealType: deal.dealType };

  /** Har o'tish uchun noyob kalit — takroriy xat ketmaydi. */
  const key = (suffix: string): string => `deal:${deal.id}:v${version}:${suffix}`;

  const items: EnqueueParams[] = [];

  /**
   * `userId` NULL bo'lishi mumkin: savdo kalit so'z bilan yaratilganda
   * xaridor hali noma'lum. Bunday holda xabar shunchaki qo'shilmaydi —
   * yuboriladigan manzil yo'q.
   */
  const add = (
    userId: string | null,
    template: EmailTemplate,
    extra: Partial<Omit<import('@escrowuz/shared').EmailContext, 'name'>> = {},
  ): void => {
    if (!userId) return;
    items.push({
      userId,
      template,
      dealId: deal.id,
      context: { ...base, ...extra },
      dedupeKey: key(`${template}:${userId}`),
    });
  };

  switch (to) {
    case 'AWAITING_PAYMENT':
      // Xaridor qabul qildi → sotuvchi biladi, xaridor to'lashi kerak
      add(deal.sellerId, 'deal.accepted');
      break;

    case 'FUNDED':
      // Eng muhim xabar: sotuvchi endi tovarni yuborishi mumkin
      add(deal.sellerId, 'deal.funded.seller');
      add(deal.buyerId, 'deal.funded.buyer');
      break;

    case 'SHIPPED':
      add(deal.buyerId, 'deal.shipped', {
        ...(params.shipment
          ? { carrier: params.shipment.carrier, trackingNumber: params.shipment.trackingNumber }
          : {}),
      });
      break;

    case 'DELIVERED':
      add(deal.sellerId, 'deal.confirmed.seller');
      break;

    case 'AUTO_RELEASED':
      add(deal.sellerId, 'deal.auto_released.seller');
      add(deal.buyerId, 'deal.auto_released.buyer');
      break;

    case 'DISPUTED':
      // Ikkala tomonga ham — nizoni ochmagan tomon buni bilishi shart
      add(deal.buyerId, 'dispute.opened', { ...(params.reason ? { reason: params.reason } : {}) });
      add(deal.sellerId, 'dispute.opened', { ...(params.reason ? { reason: params.reason } : {}) });
      break;

    case 'RESOLVED_BUYER':
    case 'RESOLVED_SELLER':
    case 'RESOLVED_SPLIT':
      add(deal.buyerId, 'dispute.resolved', { ...(params.reason ? { reason: params.reason } : {}) });
      add(deal.sellerId, 'dispute.resolved', {
        ...(params.reason ? { reason: params.reason } : {}),
      });
      break;

    case 'REFUNDED':
      add(deal.buyerId, 'deal.refunded', { ...(params.reason ? { reason: params.reason } : {}) });
      add(deal.sellerId, 'deal.cancelled', { ...(params.reason ? { reason: params.reason } : {}) });
      break;

    case 'CANCELLED':
      add(deal.buyerId, 'deal.cancelled', { ...(params.reason ? { reason: params.reason } : {}) });
      add(deal.sellerId, 'deal.cancelled', { ...(params.reason ? { reason: params.reason } : {}) });
      break;

    case 'EXPIRED':
      add(deal.buyerId, 'deal.expired');
      add(deal.sellerId, 'deal.expired');
      break;

    case 'PAYMENT_MISMATCH':
      // Xaridorga tinchlantiruvchi xabar: puli yo'qolmagan
      add(deal.buyerId, 'payment.mismatch');
      break;

    default:
      // DRAFT ga o'tish yo'q; qolganlarida xabar kerak emas
      break;
  }

  if (items.length > 0) await enqueueMany(items, tx);
}

/**
 * Savdoni xaridor band qilganda SOTUVCHIGA xabar.
 *
 * Savdo yaratilganda xabar YUBORILMAYDI: xaridor hali noma'lum, kalit so'z
 * esa sotuvchining o'zida. Xabar xaridor kalit so'zni kiritib savdoni
 * ochgandan keyin ketadi.
 *
 * `counterpartyName` chaqiruvchidan keladi — bu yerda bazadan qidirmaymiz,
 * chunki funksiya savdo tranzaksiyasi ichida ishlaydi.
 */
export async function notifyDealClaimed(
  deal: Deal,
  recipientId: string,
  counterpartyName: string,
  tx: Prisma.TransactionClient,
): Promise<void> {
  await enqueueMany(
    [
      {
        userId: recipientId,
        template: 'deal.invited',
        dealId: deal.id,
        context: {
          dealTitle: deal.title,
          amount: formatTiyin(escrowAmountOf(deal)),
          counterparty: counterpartyName,
          dealType: deal.dealType,
        },
        dedupeKey: `deal:${deal.id}:claimed`,
      },
    ],
    tx,
  );
}

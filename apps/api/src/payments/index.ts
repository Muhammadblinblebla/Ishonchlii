/**
 * To'lov provayderini tanlash.
 *
 * Tizimning qolgan qismi FAQAT `getPaymentProvider()` ni chaqiradi va
 * `PaymentProvider` interfeysini biladi. Qaysi provayder ishlayotgani
 * boshqa hech qayerda bilinmaydi.
 */

import { env } from '../config/env.js';
import { CheckoutUzProvider } from './checkout-uz.provider.js';
import { MockPaymentProvider } from './mock.provider.js';
import type { PaymentProvider } from './provider.js';

let instance: PaymentProvider | null = null;

export function getPaymentProvider(): PaymentProvider {
  if (instance) return instance;

  switch (env.PAYMENT_PROVIDER) {
    case 'checkout_uz':
      instance = new CheckoutUzProvider();
      break;
    case 'mock':
      instance = new MockPaymentProvider();
      break;
  }

  return instance;
}

/** Testlar uchun — boshqa provayder bilan almashtirish. */
export function setPaymentProvider(provider: PaymentProvider | null): void {
  instance = provider;
}

export * from './provider.js';
export { MockPaymentProvider } from './mock.provider.js';
export {
  CheckoutUzProvider,
  NotImplementedError,
  PaymentAmountError,
} from './checkout-uz.provider.js';

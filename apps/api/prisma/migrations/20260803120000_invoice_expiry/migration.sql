-- Hisob-faktura muddati. checkout.uz havolani 1 SOATDA o'chiradi,
-- bizning 48 soatlik to'lov oynamizdan qisqa.
ALTER TABLE "invoices" ADD COLUMN "expires_at" TIMESTAMP(3);

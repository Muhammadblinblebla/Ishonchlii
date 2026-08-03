-- Xabarnoma matni endi YUBORISH paytida quriladi, navbatga qo'yishda emas.
-- Sababi: matnni qurish uchun foydalanuvchi ismi kerak, ya'ni qo'shimcha
-- so'rov. Uni savdo tranzaksiyasi ichida qilish tranzaksiyani cho'zadi.
ALTER TABLE "notifications" ADD COLUMN "context" JSONB NOT NULL DEFAULT '{}';
ALTER TABLE "notifications" ALTER COLUMN "recipient" DROP NOT NULL;
ALTER TABLE "notifications" ALTER COLUMN "subject" DROP NOT NULL;
ALTER TABLE "notifications" ALTER COLUMN "body" DROP NOT NULL;

-- Xabarnoma matni endi YUBORISH paytida quriladi, navbatga qo'yishda emas.
ALTER TABLE "notifications" ADD COLUMN "context" JSONB NOT NULL DEFAULT '{}';
ALTER TABLE "notifications" ALTER COLUMN "recipient" DROP NOT NULL;
ALTER TABLE "notifications" ALTER COLUMN "subject" DROP NOT NULL;
ALTER TABLE "notifications" ALTER COLUMN "body" DROP NOT NULL;

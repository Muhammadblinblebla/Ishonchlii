-- ╔════════════════════════════════════════════════════════════════════════════╗
-- ║  KALIT SO'Z BILAN SAVDO + RAQAMLI MAHSULOT + CHAT + HAMYON MUZLATISHI     ║
-- ║                                                                            ║
-- ║  Pul matematikasiga (komissiya, escrow, ikki yoqlama hisob) tegilmaydi.    ║
-- ╚════════════════════════════════════════════════════════════════════════════╝

-- ─── 1. Yangi savdo turi ─────────────────────────────────────────────────────

ALTER TYPE "DealType" ADD VALUE IF NOT EXISTS 'DIGITAL';

CREATE TYPE "ContentKind" AS ENUM ('link', 'text', 'file');

-- ─── 2. Kalit so'z va "band qilinmagan" savdolar ─────────────────────────────

-- Xaridor endi savdo yaratilishida NOMA'LUM: sotuvchi kalit so'z beradi,
-- xaridor uni kiritib savdoni band qiladi.
ALTER TABLE "deals" ALTER COLUMN "buyer_id" DROP NOT NULL;
ALTER TABLE "deals" ADD COLUMN "claimed_at" TIMESTAMP(3);

-- Mavjud savdolar allaqachon band qilingan hisoblanadi.
UPDATE "deals" SET "claimed_at" = "created_at" WHERE "buyer_id" IS NOT NULL;

-- Kalit so'z. Eski savdolar uchun ID'dan hosil qilinadi — ular baribir
-- qidiruvda chiqmaydi (band qilingan).
ALTER TABLE "deals" ADD COLUMN "keyword" TEXT NOT NULL DEFAULT '';
ALTER TABLE "deals" ADD COLUMN "keyword_normalized" TEXT NOT NULL DEFAULT '';

UPDATE "deals"
   SET "keyword" = 'old-' || SUBSTRING(REPLACE("id"::text, '-', '') FROM 1 FOR 12),
       "keyword_normalized" = 'old-' || SUBSTRING(REPLACE("id"::text, '-', '') FROM 1 FOR 12)
 WHERE "keyword" = '';

ALTER TABLE "deals" ALTER COLUMN "keyword" DROP DEFAULT;
ALTER TABLE "deals" ALTER COLUMN "keyword_normalized" DROP DEFAULT;

CREATE INDEX "deals_keyword_normalized_idx" ON "deals" ("keyword_normalized");

-- ⚠️ ENG MUHIM CHEKLOV: BAND QILINMAGAN savdolar orasida kalit so'z NOYOB.
--
-- Busiz ikkita sotuvchi bir xil kalit so'z tanlashi mumkin va xaridor
-- qaysi biriga to'layotganini bilmasdi — pul boshqa odamga ketardi.
--
-- Qisman indeks: band qilingandan keyin kalit so'z bo'shaydi va qayta
-- ishlatilishi mumkin.
CREATE UNIQUE INDEX "deals_keyword_open_unique"
    ON "deals" ("keyword_normalized")
 WHERE "buyer_id" IS NULL AND "deleted_at" IS NULL;

-- ─── 3. Raqamli mahsulot ─────────────────────────────────────────────────────

CREATE TABLE "digital_contents" (
    "id" UUID NOT NULL,
    "deal_id" UUID NOT NULL,
    "kind" "ContentKind" NOT NULL,
    -- Shifrlangan (AES-256-GCM). Ochiq matn bazaga tushmaydi.
    "payload_cipher" TEXT NOT NULL,
    "file_name" TEXT,
    "file_size" INTEGER,
    "file_mime" TEXT,
    "viewed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "digital_contents_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "digital_contents_deal_id_key" ON "digital_contents" ("deal_id");

ALTER TABLE "digital_contents"
    ADD CONSTRAINT "digital_contents_deal_id_fkey"
    FOREIGN KEY ("deal_id") REFERENCES "deals" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Topshirilgan mahsulotni almashtirib bo'lmaydi — `viewed_at` dan boshqa
-- hamma narsa o'zgarmas. Aks holda sotuvchi pul o'tishidan oldin faylni
-- boshqasiga almashtirib, xaridorni aldab ketardi.
CREATE OR REPLACE FUNCTION block_content_tamper() RETURNS TRIGGER AS $$
BEGIN
    IF NEW."payload_cipher" IS DISTINCT FROM OLD."payload_cipher"
       OR NEW."deal_id" IS DISTINCT FROM OLD."deal_id"
       OR NEW."kind" IS DISTINCT FROM OLD."kind"
       OR NEW."file_name" IS DISTINCT FROM OLD."file_name"
       OR NEW."created_at" IS DISTINCT FROM OLD."created_at" THEN
        RAISE EXCEPTION
            'digital_contents: topshirilgan mahsulotni o''zgartirib bo''lmaydi';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER digital_contents_no_tamper
    BEFORE UPDATE ON "digital_contents"
    FOR EACH ROW EXECUTE FUNCTION block_content_tamper();

CREATE TRIGGER digital_contents_no_delete
    BEFORE DELETE ON "digital_contents"
    FOR EACH ROW EXECUTE FUNCTION block_handover_delete();

-- ─── 4. Chat ─────────────────────────────────────────────────────────────────

CREATE TABLE "messages" (
    "id" UUID NOT NULL,
    "deal_id" UUID NOT NULL,
    "sender_id" UUID NOT NULL,
    -- Shifrlangan: akkaunt paroli aynan shu yerdan o'tadi.
    "body_cipher" TEXT NOT NULL,
    "read_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "messages_deal_id_created_at_idx" ON "messages" ("deal_id", "created_at");

ALTER TABLE "messages"
    ADD CONSTRAINT "messages_deal_id_fkey"
    FOREIGN KEY ("deal_id") REFERENCES "deals" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "messages"
    ADD CONSTRAINT "messages_sender_id_fkey"
    FOREIGN KEY ("sender_id") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Yozilgan xabarni tahrirlab yoki o'chirib bo'lmaydi: chat nizoda DALIL.
-- `read_at` dan boshqasi o'zgarmas.
CREATE OR REPLACE FUNCTION block_message_tamper() RETURNS TRIGGER AS $$
BEGIN
    IF NEW."body_cipher" IS DISTINCT FROM OLD."body_cipher"
       OR NEW."deal_id" IS DISTINCT FROM OLD."deal_id"
       OR NEW."sender_id" IS DISTINCT FROM OLD."sender_id"
       OR NEW."created_at" IS DISTINCT FROM OLD."created_at" THEN
        RAISE EXCEPTION 'messages: yozilgan xabarni o''zgartirib bo''lmaydi';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER messages_no_tamper
    BEFORE UPDATE ON "messages"
    FOR EACH ROW EXECUTE FUNCTION block_message_tamper();

CREATE TRIGGER messages_no_delete
    BEFORE DELETE ON "messages"
    FOR EACH ROW EXECUTE FUNCTION block_handover_delete();

-- ─── 5. Hamyonda 30 soatlik muzlatish ────────────────────────────────────────

CREATE TABLE "wallet_holds" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "deal_id" UUID NOT NULL,
    "amount_tiyin" BIGINT NOT NULL,
    "release_at" TIMESTAMP(3) NOT NULL,
    "released_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "wallet_holds_pkey" PRIMARY KEY ("id")
);

-- Bitta savdo bo'yicha bitta muzlatish. Takroriy yozuv pulni ikki marta
-- ko'chirishga olib kelardi.
CREATE UNIQUE INDEX "wallet_holds_deal_id_key" ON "wallet_holds" ("deal_id");
CREATE INDEX "wallet_holds_released_at_release_at_idx"
    ON "wallet_holds" ("released_at", "release_at");
CREATE INDEX "wallet_holds_user_id_released_at_idx"
    ON "wallet_holds" ("user_id", "released_at");

ALTER TABLE "wallet_holds"
    ADD CONSTRAINT "wallet_holds_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "wallet_holds"
    ADD CONSTRAINT "wallet_holds_deal_id_fkey"
    FOREIGN KEY ("deal_id") REFERENCES "deals" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Muzlatilgan summa musbat bo'lishi shart.
ALTER TABLE "wallet_holds"
    ADD CONSTRAINT "wallet_holds_amount_positive" CHECK ("amount_tiyin" > 0);

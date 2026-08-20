-- O'YIN AKKAUNTLARI SAVDOSI
--
-- Pul yo'liga (ledger, komissiya, escrow) HECH QANDAY o'zgarish kiritilmaydi.
-- Qo'shilyapti: savdo turi va akkaunt ma'lumotlarini shifrlangan topshirish.

-- ─── Savdo turi ──────────────────────────────────────────────────────────────

CREATE TYPE "DealType" AS ENUM ('PHYSICAL', 'GAME_ACCOUNT');

-- Standart PHYSICAL: mavjud savdolar xuddi avvalgidek ishlashda davom etadi.
ALTER TABLE "deals" ADD COLUMN "deal_type" "DealType" NOT NULL DEFAULT 'PHYSICAL';
ALTER TABLE "deals" ADD COLUMN "game" TEXT;

-- Ro'yxatni turga qarab filtrlash uchun.
CREATE INDEX "deals_deal_type_status_idx" ON "deals" ("deal_type", "status");

-- ─── Akkaunt topshirilishi ───────────────────────────────────────────────────

CREATE TABLE "account_handovers" (
    "id" UUID NOT NULL,
    "deal_id" UUID NOT NULL,
    -- Shifrlangan (AES-256-GCM). Ochiq matn hech qachon bazaga tushmaydi.
    "credentials_cipher" TEXT NOT NULL,
    "viewed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "account_handovers_pkey" PRIMARY KEY ("id")
);

-- Bitta savdo = bitta topshirish. Sotuvchi keyin ma'lumotni almashtirib
-- xaridorni akkauntdan mahrum qila olmaydi.
CREATE UNIQUE INDEX "account_handovers_deal_id_key" ON "account_handovers" ("deal_id");

ALTER TABLE "account_handovers"
    ADD CONSTRAINT "account_handovers_deal_id_fkey"
    FOREIGN KEY ("deal_id") REFERENCES "deals" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ─── HIMOYA: shifrlangan ma'lumot O'ZGARMAS ─────────────────────────────────
--
-- `viewed_at` ni belgilashga ruxsat, qolganini o'zgartirishga YO'Q.
--
-- Nega baza darajasida: ilova kodida bunday endpoint yo'q, lekin kelajakda
-- kimdir qo'shib qo'yishi mumkin. O'shanda sotuvchi pul o'tishidan oldin
-- ma'lumotni almashtirib, xaridorni akkauntsiz qoldirib ketardi.

CREATE OR REPLACE FUNCTION block_handover_tamper() RETURNS TRIGGER AS $$
BEGIN
    IF NEW."credentials_cipher" IS DISTINCT FROM OLD."credentials_cipher"
       OR NEW."deal_id" IS DISTINCT FROM OLD."deal_id"
       OR NEW."created_at" IS DISTINCT FROM OLD."created_at" THEN
        RAISE EXCEPTION
            'account_handovers: topshirilgan akkaunt ma''lumotlarini o''zgartirib bo''lmaydi';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER account_handovers_no_tamper
    BEFORE UPDATE ON "account_handovers"
    FOR EACH ROW EXECUTE FUNCTION block_handover_tamper();

-- O'chirish ham bloklanadi: "o'chirib qayta yozish" ham ma'lumotni
-- almashtirishning bir yo'li.
--
-- Kelajakda eski savdolarning parollarini tozalash kerak bo'lsa (ular
-- muddatsiz saqlanishi shart emas), buni ataylab yozilgan migratsiya
-- triggerni vaqtincha o'chirib bajaradi — tasodifan emas.
CREATE OR REPLACE FUNCTION block_handover_delete() RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'account_handovers: yozuvni o''chirib bo''lmaydi';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER account_handovers_no_delete
    BEFORE DELETE ON "account_handovers"
    FOR EACH ROW EXECUTE FUNCTION block_handover_delete();

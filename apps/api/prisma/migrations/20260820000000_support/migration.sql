-- QO'LLAB-QUVVATLASH: murojaatlar, xabarlar, rasm biriktirish

CREATE TYPE "SupportStatus" AS ENUM ('open', 'answered', 'closed');

CREATE TABLE "support_tickets" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "subject" TEXT NOT NULL,
    "status" "SupportStatus" NOT NULL DEFAULT 'open',
    "deal_id" UUID,
    "last_message_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "support_tickets_pkey" PRIMARY KEY ("id")
);

-- Admin navbati: javob kutayotganlar eng oldin, eng uzoq kutgani yuqorida
CREATE INDEX "support_tickets_status_last_message_at_idx"
    ON "support_tickets" ("status", "last_message_at");
CREATE INDEX "support_tickets_user_id_created_at_idx"
    ON "support_tickets" ("user_id", "created_at");

ALTER TABLE "support_tickets"
    ADD CONSTRAINT "support_tickets_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "support_tickets"
    ADD CONSTRAINT "support_tickets_deal_id_fkey"
    FOREIGN KEY ("deal_id") REFERENCES "deals" ("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "support_messages" (
    "id" UUID NOT NULL,
    "ticket_id" UUID NOT NULL,
    -- NULL = admin yozdi
    "sender_id" UUID,
    "body" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "support_messages_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "support_messages_ticket_id_created_at_idx"
    ON "support_messages" ("ticket_id", "created_at");

ALTER TABLE "support_messages"
    ADD CONSTRAINT "support_messages_ticket_id_fkey"
    FOREIGN KEY ("ticket_id") REFERENCES "support_tickets" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "support_messages"
    ADD CONSTRAINT "support_messages_sender_id_fkey"
    FOREIGN KEY ("sender_id") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Rasm ALOHIDA jadvalda: xabarlar ro'yxatini o'qiganda baytlar tortilmasin.
CREATE TABLE "support_attachments" (
    "id" UUID NOT NULL,
    "message_id" UUID NOT NULL,
    "data" BYTEA NOT NULL,
    "mime" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "file_name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "support_attachments_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "support_attachments_message_id_key"
    ON "support_attachments" ("message_id");

ALTER TABLE "support_attachments"
    ADD CONSTRAINT "support_attachments_message_id_fkey"
    FOREIGN KEY ("message_id") REFERENCES "support_messages" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Hajm chegarasi BAZA darajasida ham: ilova kodidagi tekshiruvdan
-- o'tib ketgan katta fayl bazani to'ldirib qo'ymasin. 2 MB.
ALTER TABLE "support_attachments"
    ADD CONSTRAINT "support_attachments_size_limit"
    CHECK ("size_bytes" > 0 AND "size_bytes" <= 2097152);

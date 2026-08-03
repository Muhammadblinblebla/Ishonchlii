-- ╔════════════════════════════════════════════════════════════════════════════╗
-- ║  APPEND-ONLY HIMOYA + LEDGER INVARIANTLARI                                ║
-- ║                                                                            ║
-- ║  Bu qoidalar ILOVA darajasida emas, BAZA darajasida turadi. Sababi:        ║
-- ║  ilovadagi xato, qo'lda yozilgan SQL yoki kelajakdagi migratsiya          ║
-- ║  moliyaviy tarixni buzib yubormasligi kerak.                              ║
-- ╚════════════════════════════════════════════════════════════════════════════╝


-- ─────────────────────────────────────────────────────────────────────────────
-- 1. `ledger_entries` va `deal_events` — faqat INSERT
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION escrow_block_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION
    '% jadvali append-only: % amali taqiqlangan. Tuzatish uchun teskari yozuv (adjustment) qo''shing.',
    TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$;

DROP TRIGGER IF EXISTS ledger_entries_append_only ON ledger_entries;
CREATE TRIGGER ledger_entries_append_only
  BEFORE UPDATE OR DELETE ON ledger_entries
  FOR EACH ROW EXECUTE FUNCTION escrow_block_mutation();

DROP TRIGGER IF EXISTS ledger_entries_no_truncate ON ledger_entries;
CREATE TRIGGER ledger_entries_no_truncate
  BEFORE TRUNCATE ON ledger_entries
  FOR EACH STATEMENT EXECUTE FUNCTION escrow_block_mutation();

DROP TRIGGER IF EXISTS deal_events_append_only ON deal_events;
CREATE TRIGGER deal_events_append_only
  BEFORE UPDATE OR DELETE ON deal_events
  FOR EACH ROW EXECUTE FUNCTION escrow_block_mutation();

DROP TRIGGER IF EXISTS deal_events_no_truncate ON deal_events;
CREATE TRIGGER deal_events_no_truncate
  BEFORE TRUNCATE ON deal_events
  FOR EACH STATEMENT EXECUTE FUNCTION escrow_block_mutation();


-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Nol summali yozuv ma'nosiz — bloklanadi
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE ledger_entries
  DROP CONSTRAINT IF EXISTS ledger_amount_nonzero;
ALTER TABLE ledger_entries
  ADD CONSTRAINT ledger_amount_nonzero CHECK (amount <> 0);


-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Har bir tranzaksiya guruhining yig'indisi = 0
--
--    DEFERRABLE constraint trigger: tekshiruv COMMIT paytida ishlaydi, chunki
--    guruhning oyoqlari ketma-ket qo'shiladi va oraliqda yig'indi 0 emas.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION escrow_assert_transaction_balanced()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  leg_count  INTEGER;
  leg_sum    BIGINT;
  currencies INTEGER;
BEGIN
  SELECT COUNT(*), COALESCE(SUM(amount), 0), COUNT(DISTINCT currency)
    INTO leg_count, leg_sum, currencies
    FROM ledger_entries
   WHERE transaction_id = NEW.transaction_id;

  IF leg_count < 2 THEN
    RAISE EXCEPTION
      'Ledger tranzaksiyasi % da atigi % ta yozuv bor — kamida 2 ta bo''lishi shart.',
      NEW.transaction_id, leg_count
      USING ERRCODE = 'check_violation';
  END IF;

  IF currencies > 1 THEN
    RAISE EXCEPTION
      'Ledger tranzaksiyasi % da % xil valyuta aralashgan.',
      NEW.transaction_id, currencies
      USING ERRCODE = 'check_violation';
  END IF;

  IF leg_sum <> 0 THEN
    RAISE EXCEPTION
      'Ledger tranzaksiyasi % muvozanatsiz: yig''indi = % (0 bo''lishi shart).',
      NEW.transaction_id, leg_sum
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS ledger_entries_balanced ON ledger_entries;
CREATE CONSTRAINT TRIGGER ledger_entries_balanced
  AFTER INSERT ON ledger_entries
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION escrow_assert_transaction_balanced();


-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Yakuniy holatdan chiqishni bazada ham bloklash
--
--    State machine buni allaqachon tekshiradi. Bu — ikkinchi qavat: ilovadagi
--    xato yoki qo'lda UPDATE tugallangan savdoni qayta ochib yubormasligi uchun.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION escrow_block_terminal_transition()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.status <> NEW.status
     AND OLD.status IN (
       'DELIVERED', 'AUTO_RELEASED', 'RESOLVED_BUYER', 'RESOLVED_SELLER',
       'RESOLVED_SPLIT', 'REFUNDED', 'CANCELLED', 'EXPIRED'
     )
  THEN
    RAISE EXCEPTION
      'Savdo % yakuniy % holatida — % holatiga o''tkazib bo''lmaydi.',
      OLD.id, OLD.status, NEW.status
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS deals_terminal_guard ON deals;
CREATE TRIGGER deals_terminal_guard
  BEFORE UPDATE ON deals
  FOR EACH ROW EXECUTE FUNCTION escrow_block_terminal_transition();


-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Summalar manfiy bo'lmasligi
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE deals DROP CONSTRAINT IF EXISTS deals_amount_positive;
ALTER TABLE deals ADD CONSTRAINT deals_amount_positive CHECK (amount_tiyin > 0);

ALTER TABLE deals DROP CONSTRAINT IF EXISTS deals_commission_nonneg;
ALTER TABLE deals ADD CONSTRAINT deals_commission_nonneg
  CHECK (commission_tiyin >= 0 AND commission_tiyin <= amount_tiyin);

ALTER TABLE payouts DROP CONSTRAINT IF EXISTS payouts_amount_positive;
ALTER TABLE payouts ADD CONSTRAINT payouts_amount_positive CHECK (amount_tiyin > 0);

ALTER TABLE invoices DROP CONSTRAINT IF EXISTS invoices_amount_positive;
ALTER TABLE invoices ADD CONSTRAINT invoices_amount_positive CHECK (amount_tiyin > 0);

ALTER TABLE disputes DROP CONSTRAINT IF EXISTS disputes_share_range;
ALTER TABLE disputes ADD CONSTRAINT disputes_share_range
  CHECK (buyer_share_bps IS NULL OR (buyer_share_bps >= 0 AND buyer_share_bps <= 10000));


-- ─────────────────────────────────────────────────────────────────────────────
-- 6. Xaridor va sotuvchi bir odam bo'lmasligi
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE deals DROP CONSTRAINT IF EXISTS deals_distinct_parties;
ALTER TABLE deals ADD CONSTRAINT deals_distinct_parties CHECK (buyer_id <> seller_id);

# Escrowuz — xavfsiz savdo platformasi

Xaridor pulni platformaga tushiradi, pul muzlatib turiladi, sotuvchi tovarni
yuboradi, xaridor "Tasdiqlayman" bosgandan **keyingina** pul sotuvchiga o'tadi.

> **Asosiy qoida:** pul hech qachon yo'qolmasligi yoki ikki marta hisoblanmasligi
> kerak. Har qanday shubhali holatda tizim pulni **ushlab turadi**.

---

## Hozirgi holat

| Bosqich | Holat |
|---|---|
| 1. Skelet, Prisma sxema, migratsiyalar | ✅ tugadi |
| 2. Auth (register / login / refresh) | ⬜ navbatda |
| 3. State machine + ledger | ⬜ |
| 4. Savdo API + mock to'lov | ⬜ |
| 5. Frontend | ⬜ |
| 6. Nizo + admin panel | ⬜ |
| 7. Fon vazifalari | ⬜ |
| 8. Integratsiya testlari | ⬜ |

---

## Ishga tushirish

### 1. Bog'liqliklar

```bash
npm install
```

### 2. Supabase ulanishi

Supabase panelida: **Project Settings → Database → Connection string**.

`.env` faylida ikkita satrni to'ldiring:

```bash
# "Transaction pooler" (port 6543) — ilova ish vaqtida ishlatadi
DATABASE_URL="postgresql://postgres.<ref>:<PAROL>@aws-0-<region>.pooler.supabase.com:6543/postgres?pgbouncer=true&connection_limit=1"

# "Direct connection" (port 5432) — faqat migratsiyalar uchun
DIRECT_URL="postgresql://postgres.<ref>:<PAROL>@aws-0-<region>.pooler.supabase.com:5432/postgres"
```

Nega ikkita: `prisma migrate` pgbouncer orqali ishlamaydi, unga to'g'ridan-to'g'ri
ulanish kerak. Ilovaning o'zi esa pooler orqali ishlashi kerak, aks holda
Supabase'ning ulanish chegarasiga tez urilib qolasiz.

> Parolda `@ : / ? #` belgilari bo'lsa URL-encode qiling (`@` → `%40`).

### 3. Migratsiyalar va boshlang'ich ma'lumot

```bash
npm run db:generate   # Prisma client
npm run db:deploy     # migratsiyalarni qo'llash
npm run db:seed       # admin + 2 ta test foydalanuvchi (faqat dev)
```

### 4. Tekshirish

```bash
npm run typecheck
npm test
npm run ledger:check   # butun ledger SUM(amount) = 0 bo'lishi shart
```

---

## Loyiha tuzilishi

```
packages/shared/          ikkala tomon ishlatadigan mantiq
  deal-status.ts          holatlar ro'yxati, yakuniy holatlar
  commission-policy.ts    ← komissiya qoidalarining YAGONA manbai
  accounts.ts             ledger hisoblarining nomlanishi

apps/api/                 Fastify monolit
  prisma/schema.prisma    12 ta jadval
  prisma/migrations/
    ..._init              jadvallar, indekslar, tashqi kalitlar
    ..._guards            append-only triggerlar, ledger invariantlari
  scripts/check-ledger.ts CI uchun muvozanat tekshiruvi

apps/web/                 Next.js (5-bosqichda)
```

---

## Pul qanday saqlanadi

Foydalanuvchi jadvalida `balance` ustuni **yo'q**. Balans doim `ledger_entries`
jadvalidan `SUM()` orqali hisoblanadi.

Barcha summalar **butun son, tiyinda** (`BigInt`). `float`/`double` ishlatilmaydi.

Har bir pul harakati kamida 2 ta yozuvdan iborat va guruh yig'indisi doim `0`.
Bu ilova darajasida ham, **baza darajasida ham** majburlanadi — `ledger_entries`
jadvalidagi `DEFERRABLE CONSTRAINT TRIGGER` muvozanatsiz tranzaksiyani
`COMMIT` paytida rad etadi.

### Misol: 100 000 so'm to'lov keldi

```
 -10 000 000  external:payme               tashqi dunyodan kirdi
 +10 000 000  platform:escrow              platforma aktivi
 +10 000 000  user:<sotuvchi>:pending      sotuvchining shartli da'vosi
 -10 000 000  platform:escrow_liability    majburiyat
 ───────────
           0  ✓
```

### Misol: tovar tasdiqlandi (komissiya 3%)

```
 -10 000 000  platform:escrow
 +10 000 000  platform:escrow_liability
 -10 000 000  user:<sotuvchi>:pending
  +9 700 000  user:<sotuvchi>:available
    +300 000  platform:revenue
 ───────────
           0  ✓
```

---

## Komissiya

Barcha qoidalar **bitta faylda**: `packages/shared/src/commission-policy.ts`.
Boshqa hech qaysi faylda foiz yoki qoida yozilmaydi.

`amount_tiyin` — kelishilgan **tovar narxi**. Xaridor to'laydigan summa
`commission_payer` ga bog'liq:

| `commission_payer` | Xaridor to'laydi | Sotuvchi oladi | Platforma |
|---|---:|---:|---:|
| `seller` | 10 000 000 | 9 700 000 | 300 000 |
| `buyer` | 10 300 000 | 10 000 000 | 300 000 |
| `split` | 10 150 000 | 9 850 000 | 300 000 |

**Qaytarish qoidalari** (`refundRules`):

| Holat | Standart qoida |
|---|---|
| `REFUNDED` (sotuvchi bekor qildi) | `return_all` — 100% qaytadi |
| `RESOLVED_BUYER` (nizo xaridor foydasiga) | `return_all` |
| `RESOLVED_SPLIT` | `take_commission` — avval komissiya, qolgani foizda |
| `EXPIRED`, `CANCELLED` | `return_all` |

Yaxlitlashda bo'linmay qolgan tiyin **xaridorga** beriladi
(`remainderTo: 'buyer'`) — shubhali holatda xaridor foydasiga.

---

## Bazadagi himoya qavatlari

Ilova mantiqidan tashqari, baza darajasida ham majburlanadi:

| Himoya | Nima qiladi |
|---|---|
| `ledger_entries` append-only trigger | `UPDATE` / `DELETE` / `TRUNCATE` rad etiladi |
| `deal_events` append-only trigger | tarixni o'zgartirib bo'lmaydi |
| `ledger_entries_balanced` | muvozanatsiz tranzaksiya `COMMIT` da rad etiladi |
| `deals_terminal_guard` | yakuniy holatdagi savdoni qayta ochib bo'lmaydi |
| `deals_distinct_parties` | xaridor va sotuvchi bir odam bo'la olmaydi |
| `ledger_amount_nonzero` | nol summali yozuv bloklanadi |
| `deals_commission_nonneg` | komissiya manfiy yoki summadan katta bo'la olmaydi |

---

## Foydali buyruqlar

```bash
npm run typecheck            # tiplarni tekshirish
npm test                     # barcha testlar
npm run ledger:check         # ledger muvozanati (CI ham shuni ishlatadi)
npm run db:studio            # Prisma Studio — bazani ko'rish
npm run dev:api              # API (3001-port)
npm run dev:web              # Frontend (3000-port)

docker compose up redis      # Redis (7-bosqichdan kerak)
```

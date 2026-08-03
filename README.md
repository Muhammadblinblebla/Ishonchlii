# Escrow.uz — xavfsiz savdo platformasi

Xaridor pulni platformaga tushiradi, pul muzlatib turiladi, sotuvchi tovarni
yuboradi, xaridor "Tasdiqlayman" bosgandan **keyingina** pul sotuvchiga o'tadi.

> **Asosiy qoida:** pul hech qachon yo'qolmasligi yoki ikki marta hisoblanmasligi
> kerak. Har qanday shubhali holatda tizim pulni **ushlab turadi**.

---

## Holat

| Bosqich | Holat |
|---|---|
| 1. Skelet, Prisma sxema, migratsiyalar | ✅ |
| 2. Auth (register / login / refresh) | ✅ |
| 3. State machine + pul matematikasi + ledger | ✅ |
| 4. Savdo API + webhook + hamyon | ✅ |
| 5. Frontend (landing, auth, dashboard, savdo, hamyon) | ✅ |
| 6. Nizo hal qilish + admin panel | ✅ |
| 7. Fon vazifalari (timeoutlar, auto-release) | ✅ |
| 8. Deploy yo'riqnomasi | ✅ [DEPLOY.md](DEPLOY.md) |

**203 test o'tadi** (135 API + 68 sof mantiq), typecheck toza,
ledger muvozanatda.

### Ma'lum bo'shliqlar

| Bo'shliq | Holat |
|---|---|
| Sotuvchi pulini yechishi (payout) | ❌ checkout.uz'da bunday API yo'q |
| Nizoga dalil (rasm) biriktirish | ❌ faqat matn |
| Deploy | ⬜ [DEPLOY.md](DEPLOY.md) tayyor |

### Fon vazifalari

Server ishga tushganda 4 ta vazifa avtomatik boshlanadi:

| Vazifa | Har | Nima qiladi |
|---|---|---|
| `reconcile-payments` | 2 daq | Yo'qolgan to'lovlarni topadi — webhook kelmagan bo'lsa ham |
| `retry-webhooks` | 5 daq | Ishlanmagan webhooklarni qayta uradi |
| `auto-release` | 10 daq | 7 kun o'tgan `SHIPPED` savdolarni yakunlaydi |
| `expire-unpaid` | 15 daq | 48 soat to'lanmagan savdolarni yopadi |

Birinchisi eng muhimi: checkout.uz webhook'ni **qayta yubormaydi**, shuning
uchun deploy paytida kelgan to'lov xabari yo'qoladi. Bu vazifa provayderdan
o'zi so'rab, yo'qolgan to'lovni topadi.

`expire-unpaid` savdoni yopishdan **oldin** provayderdan to'lov kelmaganini
tekshiradi — aks holda to'lagan xaridorning savdosi bekor bo'lardi.

### Email xabarnomalari

17 ta xabar turi: savdo hodisalari, nizolar va §6 dagi uchta eslatma
(yetkazish, tasdiqlash ogohlantirishi, hal qilinmagan nizo).

Xabar savdo tranzaksiyasi ICHIDA navbatga qo'yiladi, fon vazifasi
(har 30 soniyada) yuboradi. Sabablari:

- Tranzaksiya yiqilsa xat ham ketmaydi — **bo'lmagan hodisa haqida
  xabar bormaydi**
- SMTP sekin bo'lsa savdo kutib turmaydi
- Email xizmati ishlamasa savdo davom etadi, xat keyin ketadi

Matn navbatga qo'yishda emas, **yuborish paytida** quriladi. Aks holda
foydalanuvchi ismini olish uchun tranzaksiya ichida qo'shimcha so'rov
kerak bo'lardi va qulflar uzoq ushlanardi.

Sozlash: `EMAIL_DRIVER="log"` (standart, konsolga chiqaradi) yoki
`"smtp"` + `SMTP_HOST`/`SMTP_USER`/`SMTP_PASSWORD`.

### Nizo qanday hal qilinadi

1. Xaridor yoki sotuvchi nizo ochadi (`FUNDED` yoki `SHIPPED` holatida)
2. Savdo `DISPUTED` ga o'tadi, **barcha timerlar to'xtaydi**
3. Admin `/admin/disputes` da ko'radi
4. Uch variantdan birini tanlaydi: xaridorga / sotuvchiga / bo'lib berish
5. `split` tanlansa — admin foizni surganda **aniq qancha so'm kimga
   ketishi** darhol ko'rsatiladi (server hisoblaydi, taxmin qilinmaydi)
6. Qaror sababi majburiy va ikkala tomonga ko'rinadi

---

## Ishga tushirish

```bash
npm install
npm run db:generate
```

`.env` faylida Supabase ulanish satrlarini to'ldiring
(`.env.example` da namuna bor), so'ng:

```bash
npm run db:deploy    # migratsiyalar
npm run db:seed      # admin + 2 test foydalanuvchi
npm run db:verify    # baza himoyalari ishlayotganini tekshiradi

npm run dev:api      # http://localhost:3001
npm run dev:web      # http://localhost:3000
```

### Tekshirish

```bash
npm run typecheck
npm test
npm run ledger:check   # butun ledger SUM(amount) = 0
```

> ⚠️ **Testlarni ishga tushirishdan oldin dev serverni TO'XTATING.**
> Server fon vazifalarini ishga tushiradi — ular o'sha bazadagi savdolarni
> o'zgartiradi va testlar tasodifiy yiqila boshlaydi. Bu chalkashtiruvchi
> holat: xato kodda emas, ikki jarayon bir bazani bo'lishayotganida bo'ladi.
>
> Uzoq muddatli yechim — testlar uchun alohida baza.

---

## Arxitektura

```
packages/shared/          ikkala tomon ishlatadigan mantiq
  deal-status.ts          holatlar, yakuniy holatlar
  deal-state-machine.ts   ← 17 o'tishning ANIQ ro'yxati
  money.ts                ← BigInt/tiyin, yaxlitlash qoldig'i yo'qolmaydi
  commission-policy.ts    ← komissiya qoidalarining YAGONA manbai
  accounts.ts             ledger hisoblarining nomlanishi
  i18n/uz.ts              barcha interfeys matnlari

apps/api/                 Fastify monolit
  deals/transition.ts     ← holat o'zgarishining YAGONA yo'li
  ledger/                 ← pul yozishning YAGONA darvozasi
  payments/               provider.ts | mock | checkout-uz
  webhooks/               webhook qabul qilish

apps/web/                 Next.js App Router
```

### Uchta "yagona darvoza"

| Nima | Qayerda | Nega |
|---|---|---|
| Holat o'zgarishi | `deals/transition.ts` | Hech qayerda `deal.update({status})` yozilmaydi |
| Pul yozuvi | `ledger/ledger.service.ts` | Muvozanat va idempotentlik bir joyda majburlanadi |
| Komissiya qoidasi | `commission-policy.ts` | Foiz kodga tarqalib ketmasligi uchun |

---

## Pul qanday saqlanadi

Foydalanuvchi jadvalida `balance` ustuni **yo'q**. Balans doim `ledger_entries`
dan `SUM()` orqali hisoblanadi.

Summalar **butun son, tiyinda** (`BigInt`). `float` ishlatilmaydi.

Har bir pul harakati kamida 2 ta yozuvdan iborat, guruh yig'indisi doim `0`.
Bu **uch qavatda** majburlanadi:

1. `LedgerService.post()` — yozishdan oldin tekshiradi
2. `ledger_entries_balanced` — `DEFERRABLE` trigger, `COMMIT` paytida rad etadi
3. `npm run ledger:check` — CI'da butun jadvalni tekshiradi

### To'lov keldi (100 000 so'm)

```
 -10 000 000  external:checkout_uz         tashqi dunyodan
 +10 000 000  platform:escrow              platforma aktivi
 +10 000 000  user:<sotuvchi>:pending      shartli da'vo
 -10 000 000  platform:escrow_liability    majburiyat
 ───────────
           0  ✓
```

### Tasdiqlandi (komissiya 3%)

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

`amount_tiyin` — kelishilgan **tovar narxi**. Xaridor to'laydigan summa
`commission_payer` ga bog'liq:

| `commission_payer` | Xaridor to'laydi | Sotuvchi oladi | Platforma |
|---|---:|---:|---:|
| `seller` | 10 000 000 | 9 700 000 | 300 000 |
| `buyer` | 10 300 000 | 10 000 000 | 300 000 |
| `split` | 10 150 000 | 9 850 000 | 300 000 |

Yaxlitlash qoldig'i **xaridorga** beriladi (`remainderTo: 'buyer'`).

---

## checkout.uz haqida bilish kerak bo'lgan narsalar

Hujjat: <https://checkout.uz/api-docs>

| Nuqta | Ta'siri |
|---|---|
| **Webhook'da imzo yo'q** | Webhook'ga ishonilmaydi — har safar `/status_payment` orqali provayderdan tasdiq so'raladi |
| **Summa so'mda** | Tiyin 100 ga bo'linadi; bo'linmasa **rad etiladi**, yaxlitlanmaydi |
| **Webhook qayta yuborilmaydi** | Server o'chiq bo'lsa xabar yo'qoladi → fon vazifasi kerak (7-bosqich) |
| **Sandbox yo'q** | Har qanday to'lov haqiqiy pul. Sinovni 1 000 so'mdan boshlang |
| **Payout endpointi yo'q** | Sotuvchiga pul o'tkazish qo'lda yoki boshqa yo'l bilan |

Kabinetdagi **IP Whitelist** ni yoqing — imzo yo'qligining o'rnini qisman bosadi.

`PAYMENT_PROVIDER="checkout_uz"` faqat `CHECKOUT_UZ_ENV="production"` bilan
ishlaydi. Bu ataylab: tasodifan haqiqiy to'lov yaratib qo'ymaslik uchun.

---

## Bazadagi himoya qavatlari

Ilova mantiqidan tashqari, baza darajasida ham majburlanadi:

| Himoya | Nima qiladi |
|---|---|
| `ledger_entries` append-only | `UPDATE`/`DELETE`/`TRUNCATE` rad etiladi |
| `ledger_entries_balanced` | Muvozanatsiz tranzaksiya `COMMIT` da rad etiladi |
| `deal_events` append-only | Tarixni o'zgartirib bo'lmaydi |
| `deals_terminal_guard` | Yakuniy savdo qayta ochilmaydi |
| `deals_distinct_parties` | Xaridor = sotuvchi bo'la olmaydi |

`npm run db:verify` shu himoyalarni **haqiqatan sinab ko'radi** (15 ta tekshiruv,
hammasi `ROLLBACK` bilan tugaydi).

---

## Buyruqlar

```bash
npm run typecheck            # tiplar
npm test                     # barcha testlar
npm run ledger:check         # ledger muvozanati
npm run db:verify            # baza himoyalari
npm run db:studio            # Prisma Studio
npm run dev:api              # API (3001)
npm run dev:web              # Frontend (3000)
```

---

## Ma'lum cheklovlar

- **Fon vazifalari BullMQ emas, bazaga tayanadi.** Spetsifikatsiyada Redis
  ko'rsatilgan edi, lekin bu vazifalar navbat talab qilmaydi — ular "shu
  shartga mos savdolarni top va qayta ishla" ko'rinishida, haqiqat manbai
  esa baza. Bir nechta server nusxasi ishlatilganda `FOR UPDATE SKIP LOCKED`
  kerak bo'ladi.
- **Dalil fayllarini yuklash yozilmagan.** Nizo matn bilan ochiladi, rasm
  biriktirib bo'lmaydi.

- **Testlar production bazasiga yozadi.** Alohida test bazasi (yoki Supabase
  branch) ochish kerak. `ledger_entries` append-only bo'lgani uchun test
  yozuvlari o'chirilmaydi.
- **Testlar sekin** (~11 daqiqa): Supabase `ap-northeast-1` da, har so'rov
  ~200ms yo'l vaqti oladi.
- **Redis hali ulanmagan** — 7-bosqichda BullMQ uchun kerak bo'ladi.

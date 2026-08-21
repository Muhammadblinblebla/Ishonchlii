# ishonchli.uz — xavfsiz savdo platformasi

Xaridor pulni platformaga tushiradi, pul muzlatib turiladi, sotuvchi tovarni
topshiradi, xaridor "Tasdiqlayman" bosgandan **keyingina** pul sotuvchiga o'tadi.

> **Asosiy qoida:** pul hech qachon yo'qolmasligi yoki ikki marta hisoblanmasligi
> kerak. Har qanday shubhali holatda tizim pulni **ushlab turadi**.

---

## Nima sotish mumkin

| Tur | Sotuvchi nimani topshiradi | Xaridorga tasdiqlash uchun |
|---|---|---|
| **Jismoniy tovar** | yetkazuvchi + trek-raqam | 7 kun |
| **eFootball akkaunt** | chat orqali (shifrlangan) | 3 kun |
| **Raqamli mahsulot** | havola / matn / fayl (shifrlangan) | **1 soat** |

**Pul yo'li uchalasida bir xil** — escrow, komissiya, ledger, nizo hech
qanday farq qilmaydi. Farq faqat topshirish usulida va muddatda.

Barcha qoidalar bitta faylda: [`packages/shared/src/deal-types.ts`](packages/shared/src/deal-types.ts).

### Savdo qanday topiladi — KALIT SO'Z

Email almashish **kerak emas**:

1. Sotuvchi savdo yaratadi va **kalit so'z** o'ylab topadi (`efootball-2026`)
2. Kalit so'zni xaridorga aytadi — Telegram, Instagram yoki og'zaki
3. Xaridor uni saytga kiritadi → nima sotilayotgani va **narxi** ko'rinadi
4. "To'lash" bosadi → savdo band qilinadi va to'lovga o'tadi

Kalit so'z **band qilinmagan savdolar orasida noyob** (bazada qisman unique
indeks). Ikkita ochiq savdo bir xil so'zga ega bo'lsa, xaridor qaysi biriga
to'layotganini bilmasdi.

Band qilinganda kalit so'z bo'shaydi va qayta ishlatilishi mumkin.

⚠️ **Poyga holati:** ikki xaridor bir vaqtda bir xil kalit so'zni kiritishi
mumkin. Faqat bittasi o'tadi — bazada atomik `UPDATE ... WHERE buyer_id IS NULL`.

### Hamyon — 30 soatlik muzlatish

Savdo yakunlangach pul **darhol yechib olinmaydi**:

```
Savdo yakunlandi
   ↓
user:<id>:holding      ← 30 soat muzlatilgan
   ↓  (fon vazifasi: release-holds)
user:<id>:available    ← endi yechib olinadi
```

Nega kerak: to'lov tizimi to'lovni qaytarib olishi mumkin (chargeback), va
firibgar soxta savdo qilib pulni darhol yechib ketolmasligi kerak.

Hamyonda uchta alohida summa ko'rsatiladi — birlashtirilsa foydalanuvchi
"pulim bor, nega yecholmayapman?" degan savol bilan qolardi:

| Summa | Ma'nosi |
|---|---|
| **Yechib olish mumkin** | tayyor |
| **Muzlatilgan** | savdo yakunlandi, 30 soat kutilmoqda |
| **Savdoda** | savdo hali yakunlanmagan, natija noma'lum |

### Chat (eFootball)

Akkaunt chat orqali topshiriladi. Uchta qat'iy qoida:

| Qoida | Nega |
|---|---|
| To'lovdan **oldin** chat yo'q | Aks holda tomonlar platformadan tashqarida komissiyasiz kelishib ketishardi |
| Xabar matni **shifrlangan** | Akkaunt paroli shu yerdan o'tadi — baza nusxasida ochiq yotmasligi kerak |
| Xabarni **o'chirib bo'lmaydi** | Nizoda yozishmalar dalil (baza triggeri majburlaydi) |

### Raqamli mahsulot — 1 soat

⚠️ Bu **eng qisqa** muddat. Xaridor to'lagach 1 soat ichida tekshirishi
kerak; ulgurmasa pul avtomatik sotuvchiga o'tadi.

Shuning uchun muddat to'lov sahifasida va xatda **katta qilib** ko'rsatiladi,
eslatma xati esa yuborilmaydi (`confirmReminderHours: 0`) — xat yetib
borguncha vaqt tugaydi.

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
| 9. O'yin akkauntlari savdosi | ✅ |
| 10. Click integratsiyasi | ✅ kalitlar kutilmoqda |
| 11. Kalit so'z + raqamli mahsulot + chat + 30 soatlik muzlatish | ✅ |
| 12. Nizolarni avtomatik hal qilish (adminsiz) | ✅ |

**227 test bazasiz o'tadi** (120 API + 107 sof mantiq), typecheck toza,
ikkala ilova ham build bo'ladi.

⚠️ Bazaga tegadigan testlar (deal-flow, ledger, chat) lokalda ishonchsiz
yuradi — Supabase Tokioda va har so'rov ~1 soniya ketmoqda, natijada
90 soniyalik timeout'lar chiqadi. **CI'da bunday muammo yo'q**: u o'z
Postgres konteynerida ishlaydi, ya'ni tarmoq kechikishi nolga yaqin.

### Ma'lum bo'shliqlar

| Bo'shliq | Holat |
|---|---|
| Sotuvchi pulini yechishi (payout) | ⬜ qo'lda — admin panelida (Click SHOP API'da payout yo'q) |
| Fayl yuklash (PDF/mp4/mp3) | ⬜ Supabase Storage kalitlari kerak — hozircha havola ishlatiladi |
| Nizoga dalil (rasm) biriktirish | ❌ faqat matn |
| Baza regioni | ⚠️ Tokio — har so'rov ~1 s. Frankfurtga ko'chirish kerak |
| Deploy | ⬜ [DEPLOY.md](DEPLOY.md) tayyor |

### Fon vazifalari

Server ishga tushganda 9 ta vazifa avtomatik boshlanadi:

| Vazifa | Har | Nima qiladi |
|---|---|---|
| `reconcile-payments` | 2 daq | Yo'qolgan to'lovlarni topadi — webhook kelmagan bo'lsa ham |
| `retry-webhooks` | 5 daq | Ishlanmagan webhooklarni qayta uradi |
| `auto-release` | 5 daq | Muddati o'tgan `SHIPPED` savdolarni yakunlaydi (tovar 7 kun, akkaunt 3 kun, raqamli 1 soat) |
| `expire-unpaid` | 15 daq | 48 soat to'lanmagan savdolarni yopadi |
| `release-holds` | 10 daq | 30 soatlik muzlatish tugagan pulni `available` ga ko'chiradi |
| `auto-resolve-mismatch` | 10 daq | To'lov nomuvofiqligini avtomatik qaytaradi |
| `auto-resolve-disputes` | 30 daq | Nizolarni 24 soatdan keyin avtomatik hal qiladi |
| `reminders` | 30 daq | Topshirish va tasdiqlash eslatmalari — muddatlar savdo turiga qarab |

Birinchisi eng muhimi: deploy yoki uzilish paytida kelgan callback butunlay
yo'qolishi mumkin. Bu vazifa provayderdan o'zi so'rab, yo'qolgan to'lovni topadi
va savdoni to'g'ri holatga keltiradi.

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

### Nizo qanday hal qilinadi — ADMIN ARALASHMAYDI

Tizim nizolarni **o'zi** hal qiladi. Admin hech narsani tekshirmaydi.

```
Nizo ochildi  →  24 soat kutish  →  tizim faktlarni yig'adi  →  qaror
                 (tomonlar o'zi
                  kelishishi mumkin)
```

Qoidalar [`packages/shared/src/dispute-policy.ts`](packages/shared/src/dispute-policy.ts) da:

| Fakt | Qaror | Aniqmi |
|---|---|---|
| Sotuvchi hech narsa topshirmagan | 100% xaridorga | ✅ aniq |
| "Topshirdim" bosilgan, lekin izi yo'q | 100% xaridorga | ✅ aniq |
| Topshirilgan, xaridor ochib ko'rmagan | 100% sotuvchiga | ✅ aniq |
| Ikkalasida ham dalil bor | 50/50 | ⚠️ **taxmin** |

**Tizim nimani aniq biladi:** sotuvchi tugmani bosganmi, topshirilgan narsa
bazada bormi (mahsulot yozuvi / chat xabari / trek-raqam), xaridor uni
ochganmi (`viewedAt`, o'qilgan xabarlar).

**Tizim nimani bilmaydi:** fayl ichida va'da qilingan narsa bormi, akkaunt
haqiqatan ishlaydimi, kim rost gapiryapti.

⚠️ Shuning uchun oxirgi qator — **taxmin, hukm emas**. U ba'zan adolatsiz
bo'ladi. Bu odam aralashuvini olib tashlashning muqarrar narxi. Har bir
taxminiy qaror `deal_events` ga `certain: false` bilan yoziladi — keyinchalik
qancha nizo shu yo'l bilan hal bo'lganini ko'rish mumkin.

Admin paneli qoldi, lekin u endi **kuzatuv oynasi**: qo'lda o'zgartirish
faqat tizim qarori aniq noto'g'ri bo'lganda ishlatiladi.

### To'lov nomuvofiqligi — avtomatik

Kelgan summa savdodagiga mos kelmasa, tizim **doim bitta yo'lni** tanlaydi:
pulni xaridorga qaytaradi.

Nega har doim qaytarish: summa noto'g'ri bo'lsa savdoni davom ettirish har
ikki tomon uchun noaniqlik. Jo'natuvchiga qaytarish — yagona shubhasiz
to'g'ri harakat.

### Nima AVTOMATLASHTIRILMAGAN va nega

| Narsa | Sabab |
|---|---|
| **Sotuvchiga pul o'tkazish** | Click SHOP API'da payout endpointi **yo'q**. Bank o'tkazmasini odam bajaradi. Click payout shartnomasi tuzilsa — `supportsPayout = true` qilish yetarli, qolgan kod tayyor |

Bu kod cheklovi emas, tashqi cheklov: provayder API bermasa, hech qanday
kod pulni kartaga o'tkaza olmaydi.

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
npm run db:seed      # FAQAT administrator hisobi
npm run db:verify    # baza himoyalari ishlayotganini tekshiradi

npm run dev:api      # http://localhost:3001
npm run dev:web      # http://localhost:3000
```

### Bazani tozalash

Productionga toza start uchun (yoki test ma'lumotlari to'planib qolganda):

```bash
npm run db:reset -- --hammasini-ochirish   # HAMMASINI o'chiradi
npm run db:seed                             # administrator hisobi
```

`ledger_entries` va `deal_events` append-only — ularni `DELETE` bilan
o'chirib bo'lmaydi (baza triggeri bloklaydi). Shuning uchun tozalash
sxemani butunlay qayta quradi va migratsiyalarni qaytadan qo'llaydi.

⚠️ **Qaytarib bo'lmaydi.** Buyruq uzun bayroqsiz ishlamaydi — tasodifan
bosib yuborilmasin.

### Demo foydalanuvchilar

Standart seed HECH QANDAY namunaviy hisob yaratmaydi. Kerak bo'lsa:

```bash
npm run db:seed -- --demo    # aziz@example.uz, dilnoza@example.uz
```

Production muhitida bu buyruq rad etiladi.

### Tekshirish

```bash
npm run typecheck
npm test
npm run ledger:check   # butun ledger SUM(amount) = 0
```

> ⚠️ **`packages/shared` o'zgartirilsa web dev serverni QAYTA ISHGA TUSHIRING.**
> Turbopack workspace paketining eski nusxasini keshlab qoladi. Brauzerdagi
> kod yangi eksportni topa olmaydi va **butun sahifa jim ishdan chiqadi**:
> tugmalar bosilmaydi, xato ham ko'rinmaydi. Diagnostika qilish qiyin, chunki
> server tomondan sahifa 200 qaytaradi.
>
> ```bash
> rm -rf apps/web/.next && npm run dev:web
> ```
> Brauzerda ham qattiq yangilash kerak: **Cmd+Shift+R**.

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
  db/tx-options.ts        ← tranzaksiya muddatlarining YAGONA manbai
  payments/               provider.ts | mock | click | checkout-uz
  webhooks/               webhook qabul qilish

apps/web/                 Next.js App Router
```

### "Yagona darvoza" qoidasi

| Nima | Qayerda | Nega |
|---|---|---|
| Holat o'zgarishi | `deals/transition.ts` | Hech qayerda `deal.update({status})` yozilmaydi |
| Pul yozuvi | `ledger/ledger.service.ts` | Muvozanat va idempotentlik bir joyda majburlanadi |
| Komissiya qoidasi | `commission-policy.ts` | Foiz kodga tarqalib ketmasligi uchun |
| Tranzaksiya muddati | `db/tx-options.ts` | Chaqiruv joyiga yozilsa bir qismi eskirib qoladi |

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
 -10 000 000  external:click              tashqi dunyodan
 +10 000 000  platform:escrow              platforma aktivi
 +10 000 000  user:<sotuvchi>:pending      shartli da'vo
 -10 000 000  platform:escrow_liability    majburiyat
 ───────────
           0  ✓
```

### Tasdiqlandi (xizmat haqqi 1%)

```
 -10 000 000  platform:escrow
 +10 000 000  platform:escrow_liability
 -10 000 000  user:<sotuvchi>:pending
  +9 900 000  user:<sotuvchi>:holding      ← available EMAS
    +100 000  platform:revenue
 ───────────
           0  ✓
```

Pul `available` ga emas, **`holding`** ga tushadi: savdo yakunlandi, pul
sotuvchiniki, lekin 30 soat muzlatiladi. `release-wallet-holds` fon
vazifasi muddat o'tgach uni `available` ga o'tkazadi — shundan keyingina
yechib olsa bo'ladi.

---

## Komissiya

Barcha qoidalar **bitta faylda**: `packages/shared/src/commission-policy.ts`.

`amount_tiyin` — kelishilgan **tovar narxi**. Xaridor to'laydigan summa
`commission_payer` ga bog'liq:

Ikkita alohida foiz bor va ular **bir xil narsa emas**:

| | Foiz | Kimga tushadi |
|---|---:|---|
| Xizmat haqqi (`rateBps`) | 1% | Platformaga |
| To'lov tizimi (`providerFeeBps`) | 1% | **Click'ga** — bizga tushmaydi |

Provayder foizi xaridor to'lovi **ustiga** qo'shiladi. Aks holda escrowga
kerakli summa to'liq tushmasdi va farqni platforma o'z hisobidan qoplardi.

100 000 so'mlik savdo (tiyinda):

| `commission_payer` | Xaridor to'laydi | Escrowga tushadi | Sotuvchi oladi | Platforma | Click |
|---|---:|---:|---:|---:|---:|
| `seller` (standart) | 10 101 100 | 10 000 000 | 9 900 000 | 100 000 | 101 100 |
| `buyer` | 10 202 100 | 10 100 000 | 10 000 000 | 100 000 | 102 100 |
| `split` | 10 151 600 | 10 050 000 | 9 950 000 | 100 000 | 101 600 |

Yaxlitlash qoldig'i **xaridorga** beriladi (`remainderTo: 'buyer'`).

---

## Click haqida bilish kerak bo'lgan narsalar

Kabinet: <https://merchant.click.uz>

Click checkout.uz'dan **tubdan farq qiladi**. Farqni bilmasdan kod
o'zgartirish pul yo'qolishiga olib keladi:

| Nuqta | Ta'siri |
|---|---|
| **Callback IMZOLANGAN** (MD5 + secret_key) | Imzo to'g'ri bo'lsa — xabar haqiqatan Click'dan. checkout.uz'da imzo yo'q edi |
| **Hisob-faktura API orqali yaratilmaydi** | Shunchaki to'lov havolasi quriladi; `merchant_trans_id` ni BIZ o'ylab topamiz |
| **Ikki bosqichli callback** | Prepare (pul hali yechilmagan) → Complete (pul yechildi) |
| **Javob formati qat'iy** | Noto'g'ri javob = to'lov bekor qilinadi |
| **Summa so'mda** | Tiyin 100 ga bo'linadi; bo'linmasa **rad etiladi**, yaxlitlanmaydi |
| **Sandbox yo'q** | Har qanday to'lov haqiqiy pul. Sinovni 1 000 so'mdan boshlang |
| **Payout alohida shartnoma** | Sotuvchiga pul o'tkazish admin panelida qo'lda |

### Summa qayerda tekshiriladi

**Prepare bosqichida** — bu ataylab shunday. U yerda rad etsak pul umuman
yechilmaydi. Complete'da aniqlasak, pul allaqachon xaridordan yechilgan
bo'ladi va uni qaytarish kerak bo'lardi.

Complete'da summa **yana bir bor** tekshiriladi (pul yozishdan oldingi oxirgi
to'siq). Mos kelmasa savdo `PAYMENT_MISMATCH` ga o'tadi va admin ko'radi.

### Kabinetga kiritiladigan manzillar

```
Prepare  : https://<api-manzilingiz>/webhooks/click/prepare
Complete : https://<api-manzilingiz>/webhooks/click/complete
```

`PAYMENT_PROVIDER="click"` bo'lsa to'rt kalit ham to'ldirilgan bo'lishi shart,
aks holda server **ishga tushmaydi**. Yarim sozlangan to'lov tizimi eng xavfli
holat: savdolar yaratiladi, xaridor to'lovni bosadi va shundagina hammasi buziladi.


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

## Responsive

Barcha sahifalar 320px dan boshlab ishlaydi (eng kichik zamonaviy telefon).

| Qoida | Nima uchun |
|---|---|
| Tugmalar eng kam **44px** balandlikda | Barmoq bilan aniq tegish uchun (Apple HIG) |
| Kiritish maydonlari **16px** shriftda | Kichikroq bo'lsa iOS Safari sahifani avtomatik kattalashtiradi |
| `overflow-x: clip` | Gorizontal aylantirish butunlay bloklangan |
| `env(safe-area-inset-bottom)` | iPhone'ning pastki chizig'i ostida tugma qolmasin |
| `prefers-reduced-motion` | Animatsiyalar o'chiriladi — vestibulyar buzilishi uchun |

Mobilda: tugmalar to'liq kenglikda ustma-ust, tablar gorizontal aylanadi,
karta ichki bo'shlig'i kamayadi (`p-4` → `p-6`), uzun email va karta
raqamlari bo'linadi.

Tekshirish: brauzerda `Cmd+Option+I` → qurilma rejimi → iPhone SE (375px)
va Galaxy Fold (280px).

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

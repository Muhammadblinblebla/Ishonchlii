# Deploy — doimiy manzil olish

Maqsad: Click callback yubora oladigan **doimiy** HTTPS manzilga ega bo'lish.

```
API  →  Railway    →  https://<nom>.up.railway.app
Web  →  Vercel     →  https://<nom>.vercel.app
Baza →  Supabase   →  allaqachon ishlayapti
```

Ikkalasida ham bepul tarif yetarli. Kredit karta talab qilinmaydi.

---

## 0. Avval: kodni GitHub'ga joylash

Railway va Vercel GitHub'dan o'qiydi.

```bash
cd /Users/mac/Desktop/Escrowuz
git add -A
git commit -m "Escrow platformasi"
```

GitHub'da **yangi PRIVATE repository** yarating (`escrowuz`), so'ng:

```bash
git remote add origin https://github.com/<foydalanuvchi>/escrowuz.git
git branch -M main
git push -u origin main
```

> `.env` fayli `.gitignore` da — sirlar GitHub'ga tushmaydi. Buni tekshiring:
> `git ls-files | grep -c "^\.env$"` → **0** chiqishi kerak.

---

## 1. API → Railway

1. <https://railway.app> → GitHub bilan kiring
2. **New Project → Deploy from GitHub repo** → `escrowuz` ni tanlang
3. **Settings → Root Directory**: bo'sh qoldiring (monorepo ildizi)
4. **Settings → Config as code**: `apps/api/railway.json`

### Muhit o'zgaruvchilari (Variables)

Bularni **qo'lda** kiriting — hech qaysi biri kodda yo'q:

```bash
NODE_ENV=production

# Supabase — .env dagi bilan bir xil
DATABASE_URL=postgresql://postgres.tsomhnmqwgipaupnyxda:<PAROL>@aws-0-ap-northeast-1.pooler.supabase.com:6543/postgres?pgbouncer=true&connection_limit=1
DIRECT_URL=postgresql://postgres.tsomhnmqwgipaupnyxda:<PAROL>@aws-0-ap-northeast-1.pooler.supabase.com:5432/postgres

# YANGI sirlar yarating — dev'dagilarni ISHLATMANG:
#   openssl rand -base64 48
JWT_SECRET=<yangi>
JWT_REFRESH_SECRET=<yangi, birinchisidan boshqa>

# Vercel manzilini olgach to'ldiring (3-qadam)
CORS_ORIGINS=https://<web-nomi>.vercel.app

# O'yin akkauntlarini shifrlash kaliti — BIR MARTA o'rnatiladi
#   openssl rand -base64 48
# ⚠️ Keyin O'ZGARTIRMANG: sotilgan akkauntlar ochilmay qoladi
CREDENTIALS_SECRET=<yangi, JWT sirlaridan boshqa>

# Click — to'rttasi ham merchant.click.uz kabinetidan
PAYMENT_PROVIDER=click
CLICK_SERVICE_ID=<kabinetdan>
CLICK_MERCHANT_ID=<kabinetdan>
CLICK_SECRET_KEY=<kabinetdan>
CLICK_MERCHANT_USER_ID=<kabinetdan>

API_PORT=3001
API_HOST=0.0.0.0
```

> Server ishga tushmasa loglarni o'qing — `config/env.ts` qaysi o'zgaruvchi
> yetishmayotganini **aniq nomi bilan** yozadi va ishga tushmaydi. Bu ataylab:
> yarim sozlangan to'lov tizimi ishlab ketgandan ko'ra, umuman ko'tarilmagani
> xavfsizroq.

---

## 2. API manzilini olish

Railway → **Settings → Networking → Generate Domain**

Olingan manzil, masalan `escrowuz-api.up.railway.app`. Endi:

### 🔗 CALLBACK MANZILLARI — Click kabinetiga kiritiladi

Click **ikkita** manzil so'raydi:

```
Prepare URL  : https://escrowuz-api.up.railway.app/webhooks/click/prepare
Complete URL : https://escrowuz-api.up.railway.app/webhooks/click/complete
```

Ikkalasi ham **merchant.click.uz kabinetiga** yoziladi (`.env` ga emas —
Click bizga o'zi murojaat qiladi, biz unga emas).

⚠️ Manzillar HTTPS bo'lishi shart. HTTP'ni Click qabul qilmaydi.

Tekshirish:

```bash
curl https://escrowuz-api.up.railway.app/health
# {"status":"ok","time":"..."}
```

---

## 3. Frontend → Vercel

1. <https://vercel.com> → GitHub bilan kiring
2. **Add New → Project** → `escrowuz`
3. **Root Directory**: `apps/web`
4. Framework: Next.js (o'zi aniqlaydi)

### Muhit o'zgaruvchisi

```bash
NEXT_PUBLIC_API_URL=https://escrowuz-api.up.railway.app
```

Deploy tugagach Vercel manzilini oling (`escrowuz.vercel.app`) va
**Railway'dagi `CORS_ORIGINS` ni shu manzilga yangilang**, aks holda brauzer
so'rovlarni bloklaydi.

### 🔗 SAYT URL

```
https://escrowuz.vercel.app
```

---

## 4. Migratsiyalar va toza baza

`railway.json` dagi `startCommand` har deploy'da `prisma migrate deploy` ni
ishga tushiradi — migratsiyalar uchun qo'lda hech narsa qilish shart emas.

### Bazani tozalash

Ishlab chiqish davomida test savdolari to'planib qoladi. Haqiqiy
foydalanuvchilarni qabul qilishdan oldin bazani tozalang:

```bash
npm run db:reset -- --hammasini-ochirish   # HAMMASINI o'chiradi
npm run db:seed                             # faqat administrator
npm run db:verify                           # 15 ta himoya tekshiruvi
npm run ledger:check                        # yig'indi 0 bo'lishi kerak
```

`ledger_entries` va `deal_events` append-only — `DELETE` ni baza triggeri
bloklaydi. Shuning uchun tozalash sxemani qayta quradi.

⚠️ **Qaytarib bo'lmaydi.** Haqiqiy savdolar boshlangandan keyin bu buyruqni
ISHLATMANG — moliyaviy tarix yo'qoladi.

### Administrator

`db:seed` `.env` dagi `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` bilan
**bitta** admin yaratadi. Demo foydalanuvchilar yaratilmaydi.

Mavjud admin paroli qayta yozilmaydi — ya'ni har deploy'da parol
`.env` dagi qiymatga qaytib ketmaydi.

---

## 5. Birinchi haqiqiy to'lov — ehtiyot bo'ling

Click'da **sandbox yo'q**. Birinchi to'lov haqiqiy pul bilan bo'ladi.

Tavsiya qilingan tartib:

1. Ikkita hisob oching (o'zingiz va yaqin odam)
2. **1 000 so'mlik** savdo yarating — bu provayderning eng kam summasi
3. To'lovni amalga oshiring
4. Savdo `FUNDED` ga o'tganini tekshiring
5. Jo'natish → tasdiqlash → hamyonda pul paydo bo'lishini kuzating
6. `npm run ledger:check` — yig'indi 0 ekanini tasdiqlang

Agar 1-3 qadamda savdo `AWAITING_PAYMENT` da qolib qolsa — webhook yetib
kelmagan. Railway loglarini tekshiring: `/webhooks/click/complete` so'rovi
ko'rinadimi.

---

## ⚠️ Deploy'dan OLDIN bilishingiz kerak

Quyidagilar hali yozilmagan. Haqiqiy pul bilan ishlatishdan oldin
tugallanishi kerak:

| Bo'shliq | Oqibati |
|---|---|
| **Admin panel yo'q** | Nizo ochilsa pul muzlab qoladi, chiqarish yo'li YO'Q |
| **Fon vazifalari yo'q** | 48 soatlik to'lov muddati va 7 kunlik auto-release ishlamaydi |
| **Yo'qolgan webhook qoplanmaydi** | Deploy paytida kelgan to'lov xabari yo'qoladi → xaridor to'lagan, savdo `EXPIRED` bo'ladi |

Uchinchisi deploy uchun alohida muhim: **har bir yangi deploy paytida
server ~30 soniya o'chiq bo'ladi.** O'sha oynada kelgan webhook butunlay
yo'qolishi mumkin. `reconcile-payments` fon vazifasi uni topib beradi.

Shu sababli **avval 7-bosqichni (fon vazifalari) tugatishni tavsiya qilaman**,
keyin deploy qilish. Aks holda birinchi haqiqiy to'lovda pul "yo'qolib"
qolishi mumkin — texnik jihatdan Supabase'da turadi, lekin savdo uni
ko'rmaydi.

---

## Deploy'dan keyingi tekshiruv ro'yxati

```bash
# 1. API javob beradimi
curl https://<api>.up.railway.app/health

# 2. Noto'g'ri manzil to'g'ri xato beradimi
curl https://<api>.up.railway.app/yoq
# {"error":{"code":"NOT_FOUND",...}}

# 3. Avtorizatsiya ishlayaptimi
curl https://<api>.up.railway.app/deals
# {"error":{"code":"UNAUTHORIZED",...}}

# 4. Mock endpoint YOPIQMI (production'da 404 bo'lishi SHART)
curl -o /dev/null -w "%{http_code}\n" https://<api>.up.railway.app/dev/mock-pay/x
# 404

# 5. Sayt ochiladimi
curl -o /dev/null -w "%{http_code}\n" https://<web>.vercel.app
# 200
```

4-qator muhim: agar `404` emas, boshqa kod chiqsa — mock to'lov production'da
ochiq qolgan degani. Bu holda **darhol to'xtating**, chunki istalgan odam
pulsiz savdolarni "to'langan" qila oladi.

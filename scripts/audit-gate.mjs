/**
 * ZAIFLIKLAR DARVOZASI.
 *
 * `npm audit --audit-level=high` ning o'rnini bosadi, bitta farq bilan:
 * ataylab kechirilgan advisory'lar ro'yxati bor. Har biri uchun SABAB
 * yozilgan va QAYTA KO'RIB CHIQISH SANASI belgilangan.
 *
 * Nega shunday: `npm audit fix` bajarib bo'lmaydigan holat bor —
 * zaiflik bizning kodimizga umuman tegmaydigan joyda, lekin
 * tuzatilgan versiya hali chiqmagan. Bunday paytda ikki yomon yo'l bor:
 *   1. Darvozani butunlay o'chirish — keyin HAQIQIY zaiflik ham sezilmay qoladi
 *   2. Har safar qo'lda ko'z yugurtirish — bir kun albatta unutiladi
 * Uchinchi yo'l: aniq bitta advisory'ni sabab bilan kechirish.
 *
 * Ro'yxatdagi sana o'tsa darvoza O'ZI yiqiladi — ya'ni kechirim
 * abadiy qolib ketmaydi, qayta ko'rib chiqishga majbur qiladi.
 */

import { execFileSync } from 'node:child_process';

/** @type {{id: string, package: string, reason: string, until: string}[]} */
const ALLOWED = [
  {
    id: 'GHSA-ggr8-5vv4-36mx',
    package: 'deepmerge-ts',
    reason:
      "Prisma CLI o'z sozlama faylini birlashtirishda ishlatadi. Kirish ma'lumoti " +
      "faqat bizning `prisma.config.ts` faylimiz — tashqaridan hech kim ta'sir " +
      "qila olmaydi. Prisma'ning ENG YANGI versiyasi (7.9.1) ham shu zaiflik " +
      "ro'yxatida, ya'ni yangilash yo'li hozircha YO'Q. Majburiy `overrides` " +
      "bilan major versiyani Prisma ichiga tiqish esa `migrate deploy` ni " +
      "deploy paytida yiqitishi mumkin — bu ancha xavfliroq.",
    until: '2026-11-01',
  },
];

// `npm audit` zaiflik topsa nolga teng bo'lmagan kod bilan chiqadi va
// `execFileSync` buni XATO deb tashlaydi. Lekin JSON hisoboti baribir
// stdout'ga yozilgan bo'ladi — aynan u bizga kerak. Shuning uchun
// tashlangan xatoning ichidan stdout olinadi.
let raw;
try {
  raw = execFileSync('npm', ['audit', '--json'], {
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'ignore'],
  });
} catch (err) {
  raw = err?.stdout;
  if (typeof raw !== 'string' || raw.trim() === '') {
    console.error('\n  ❌ `npm audit` hisobot qaytarmadi (tarmoq muammosi?)\n');
    process.exit(1);
  }
}

const report = JSON.parse(raw);
const today = new Date().toISOString().slice(0, 10);

const blocking = [];
const forgiven = [];

for (const [name, vuln] of Object.entries(report.vulnerabilities ?? {})) {
  if (vuln.severity !== 'high' && vuln.severity !== 'critical') continue;

  // Advisory ID bevosita shu paketda bo'lishi ham, bog'liqlik orqali
  // kelishi ham mumkin. Ikkalasini ham tekshiramiz.
  const ids = collectAdvisoryIds(vuln, report.vulnerabilities, new Set());
  const match = ALLOWED.find((a) => ids.has(a.id));

  if (match) forgiven.push({ name, severity: vuln.severity, rule: match });
  else blocking.push({ name, severity: vuln.severity, ids: [...ids] });
}

/** Zaiflik zanjiri bo'ylab yurib, asl advisory ID'larini yig'adi. */
function collectAdvisoryIds(vuln, all, seen) {
  const ids = new Set();
  for (const via of vuln.via ?? []) {
    if (typeof via === 'object') {
      if (via.source) ids.add(String(via.source));
      const url = String(via.url ?? '');
      const ghsa = url.match(/GHSA-[\w-]+/)?.[0];
      if (ghsa) ids.add(ghsa);
      continue;
    }
    // `via` satr bo'lsa — boshqa paket nomi, zanjir davom etadi
    if (seen.has(via)) continue;
    seen.add(via);
    const next = all[via];
    if (next) for (const id of collectAdvisoryIds(next, all, seen)) ids.add(id);
  }
  return ids;
}

// ── Natija ───────────────────────────────────────────────────────────────────
let failed = false;

for (const item of forgiven) {
  const expired = item.rule.until < today;
  if (expired) {
    failed = true;
    console.error(
      `\n  ❌ ${item.name}: kechirim muddati tugagan (${item.rule.until}).\n` +
        `     Qayta ko'rib chiqing: tuzatilgan versiya chiqqanmi?\n` +
        `     Chiqmagan bo'lsa scripts/audit-gate.mjs dagi sanani suring.\n`,
    );
  } else {
    console.log(`  ⚠️  ${item.name} (${item.severity}) — ataylab kechirildi, ${item.rule.until} gacha`);
  }
}

for (const item of blocking) {
  failed = true;
  console.error(`\n  ❌ ${item.name}: ${item.severity} zaiflik — ${item.ids.join(', ')}`);
}

if (failed) {
  console.error('\n  Tuzatish: npm audit fix  (yoki sababi bilan audit-gate.mjs ga qo\'shing)\n');
  process.exit(1);
}

console.log('  ✅ Yuqori darajali kutilmagan zaiflik yo\'q.\n');

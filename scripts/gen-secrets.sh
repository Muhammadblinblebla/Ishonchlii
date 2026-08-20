#!/usr/bin/env bash
# Deploy uchun sirlarni yaratadi.
#
# Har birini Railway panelidagi mos o'zgaruvchiga ko'chiring.
# ⚠️ CREDENTIALS_SECRET ni BIR MARTA o'rnatasiz va HECH QACHON
#    o'zgartirmaysiz — almashtirilsa sotilgan mahsulotlar ochilmay qoladi.
set -euo pipefail
echo ""
echo "  Quyidagilarni Railway'ga ko'chiring:"
echo ""
printf '  JWT_SECRET="%s"\n'          "$(openssl rand -base64 48 | tr -d '\n')"
printf '  JWT_REFRESH_SECRET="%s"\n'  "$(openssl rand -base64 48 | tr -d '\n')"
printf '  CREDENTIALS_SECRET="%s"\n'  "$(openssl rand -base64 48 | tr -d '\n')"
echo ""
printf '  SEED_ADMIN_PASSWORD="%s"\n' "$(openssl rand -base64 18 | tr -d '\n=/+' | cut -c1-20)"
echo ""
echo "  ⚠️  CREDENTIALS_SECRET ni saqlab qo'ying — u qayta tiklanmaydi."
echo ""

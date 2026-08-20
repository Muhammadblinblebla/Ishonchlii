#!/usr/bin/env bash
#
# DEPLOY'NI OLDINDAN TEKSHIRISH.
#
# Railway va Vercel qiladigan narsani AYNAN takrorlaydi: toza klon,
# `.env` YO'Q, `node_modules` yo'q, `dist` yo'q.
#
# Nega kerak: mahalliy kompyuterda hammasi ishlaydi, chunki `.env` va
# tayyor `dist` bor. Deploy'da ular yo'q — va aynan shu farq build'ni
# yiqitadi. Bu skript farqni deploy'dan OLDIN ko'rsatadi.
set -uo pipefail

DIR="${TMPDIR:-/tmp}/escrowuz-deploy-check"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FAILED=0

step() { printf '\n  \033[1m%s\033[0m\n' "$1"; }
ok()   { printf '    \033[32m✅ %s\033[0m\n' "$1"; }
bad()  { printf '    \033[31m❌ %s\033[0m\n' "$1"; FAILED=1; }

run() { # run <nom> <buyruq...>
  local name="$1"; shift
  if "$@" >"$DIR/.last.log" 2>&1; then ok "$name"; else
    bad "$name"
    printf '\n'; tail -25 "$DIR/.last.log" | sed 's/^/      /'; printf '\n'
  fi
}

step "Toza klon yasalmoqda"
rm -rf "$DIR"
git clone -q --depth 1 "file://$ROOT" "$DIR" || { bad "klon"; exit 1; }
cd "$DIR"
[ -f .env ] && bad ".env klonga tushibdi — sirlar git'da!" || ok ".env yo'q (to'g'ri)"

step "Railway build bosqichlari"
run "npm ci"                npm ci --ignore-scripts
run "native modullar"       npm rebuild argon2 @prisma/client @prisma/engines
run "prisma generate"       npx prisma generate --schema apps/api/prisma/schema.prisma
run "shared build"          npm run build --workspace=@escrowuz/shared
run "api build"             npm run build --workspace=@escrowuz/api

step "Vercel build bosqichi"
( cd apps/web && NEXT_PUBLIC_API_URL="https://api.example.com" npx next build ) \
  >"$DIR/.last.log" 2>&1 && ok "web build" || { bad "web build"; tail -25 "$DIR/.last.log" | sed 's/^/      /'; }

step "Production serverini ko'tarish"
cd "$DIR/apps/api"
export NODE_ENV=production API_PORT=3099
export DATABASE_URL="postgresql://u:p@db.example.com:6543/postgres"
export DIRECT_URL="postgresql://u:p@db.example.com:5432/postgres"
export JWT_SECRET="$(openssl rand -base64 48 | tr -d '\n')"
export JWT_REFRESH_SECRET="$(openssl rand -base64 48 | tr -d '\n')"
export CREDENTIALS_SECRET="$(openssl rand -base64 48 | tr -d '\n')"
export CORS_ORIGINS="https://example.vercel.app"
export PAYMENT_PROVIDER="click" CLICK_SERVICE_ID="1" CLICK_MERCHANT_ID="2"
export CLICK_SECRET_KEY="3" CLICK_MERCHANT_USER_ID="4"
export EMAIL_DRIVER="log"

node dist/server.js >"$DIR/.server.log" 2>&1 &
SRV=$!
for _ in $(seq 1 20); do
  sleep 1
  curl -sf -m 2 "http://127.0.0.1:3099/health" >/dev/null 2>&1 && break
done

if curl -sf -m 3 "http://127.0.0.1:3099/health" >/dev/null 2>&1; then
  ok "server ko'tarildi va /health javob berdi"
  # Mock to'lov production'da YOPIQ bo'lishi SHART
  code=$(curl -s -o /dev/null -w '%{http_code}' -m 3 "http://127.0.0.1:3099/dev/mock-pay/x" || echo 000)
  [ "$code" = "404" ] && ok "mock to'lov yopiq (404)" || bad "mock to'lov OCHIQ — HTTP $code"
else
  bad "server ko'tarilmadi"
  tail -25 "$DIR/.server.log" | sed 's/^/      /'
fi
kill $SRV 2>/dev/null; wait $SRV 2>/dev/null

cd "$ROOT"; rm -rf "$DIR"
if [ "$FAILED" = "0" ]; then
  printf '\n  \033[32m✅ Deploy uchun tayyor.\033[0m\n\n'
else
  printf '\n  \033[31m❌ Deploy yiqiladi — yuqoridagi xatolarni tuzating.\033[0m\n\n'
  exit 1
fi

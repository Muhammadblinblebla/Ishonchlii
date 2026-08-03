# Escrow API — production image
#
# Monorepo bo'lgani uchun kontekst LOYIHA ILDIZIDAN olinadi:
#   docker build -f apps/api/Dockerfile .

# ─── 1-bosqich: build ────────────────────────────────────────────────────────
FROM node:22-alpine AS builder

WORKDIR /app

# argon2 va Prisma engine'lari uchun
RUN apk add --no-cache python3 make g++ openssl

# Avval faqat manifestlar — kod o'zgarganda bog'liqliklar qayta o'rnatilmasin
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/

# npm 11 install skriptlarini bloklaydi; Prisma va argon2 ularsiz ishlamaydi
RUN npm ci --ignore-scripts \
 && npm rebuild argon2 @prisma/client @prisma/engines

COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/api apps/api

RUN npx prisma generate --schema apps/api/prisma/schema.prisma \
 && npm run build --workspace=@escrowuz/shared \
 && npm run build --workspace=@escrowuz/api

# Production uchun dev bog'liqliklarni tashlaymiz
RUN npm prune --omit=dev

# ─── 2-bosqich: ishga tushirish ──────────────────────────────────────────────
FROM node:22-alpine AS runner

WORKDIR /app
RUN apk add --no-cache openssl

ENV NODE_ENV=production

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/packages/shared/dist packages/shared/dist
COPY --from=builder /app/packages/shared/package.json packages/shared/
COPY --from=builder /app/apps/api/dist apps/api/dist
COPY --from=builder /app/apps/api/package.json apps/api/
# Migratsiyalar — deploy paytida qo'llash uchun
COPY --from=builder /app/apps/api/prisma apps/api/prisma

# root bo'lmagan foydalanuvchi
RUN addgroup -g 1001 -S nodejs && adduser -S escrow -u 1001 \
 && mkdir -p /app/apps/api/storage && chown -R escrow:nodejs /app/apps/api/storage
USER escrow

EXPOSE 3001

# Konteyner sog'ligini tekshirish — orkestrator o'lik jarayonni qayta ko'taradi
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.API_PORT||3001)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

WORKDIR /app/apps/api
CMD ["node", "dist/server.js"]

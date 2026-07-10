FROM node:20-alpine AS deps

WORKDIR /app/apps/web

ENV NEXT_TELEMETRY_DISABLED=1

COPY apps/web/package.json apps/web/package-lock.json ./
RUN npm ci --include=dev

FROM node:20-alpine AS builder

WORKDIR /app/apps/web

ENV NEXT_TELEMETRY_DISABLED=1

COPY --from=deps /app/apps/web/node_modules ./node_modules
COPY apps/web ./

RUN npm run build

FROM node:20-alpine AS runner

WORKDIR /app/apps/web

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

COPY apps/web/package.json apps/web/package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

COPY --from=builder /app/apps/web/.next ./.next
COPY --from=builder /app/apps/web/public ./public
COPY --from=builder /app/apps/web/next.config.mjs ./next.config.mjs

EXPOSE 3000

CMD ["sh", "-c", "npm start -- -H 0.0.0.0 -p ${PORT:-3000}"]

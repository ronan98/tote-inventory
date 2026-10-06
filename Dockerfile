ARG NODE_IMAGE=node:24.21.0-bookworm-slim@sha256:0e0ff40c39bc087845bfb27465a0df4ea419520094bc35842ff83dd8cbe6f9b6
FROM ${NODE_IMAGE} AS base
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
FROM base AS deps
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci --no-fund --no-audit
FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NODE_OPTIONS=--max-old-space-size=1536
RUN mkdir -p public && npm run build
FROM builder AS test
RUN npm test && npx tsc --noEmit
FROM base AS runner
ENV NODE_ENV=production HOSTNAME=0.0.0.0 PORT=3000 INVENTORY_DATA_DIR=/data BACKUP_DIR=/backups
RUN mkdir -p /data/photos /backups /app/.next/cache && chown -R node:node /data /backups /app
COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static
COPY --from=builder --chown=node:node /app/public ./public
COPY --from=deps --chown=node:node /app/node_modules/better-sqlite3 ./node_modules/better-sqlite3
COPY --chown=node:node scripts ./scripts
COPY --from=builder --chown=node:node /app/.next/ai-worker.cjs ./scripts/ai-worker.cjs
COPY --chown=node:node LICENSE THIRD-PARTY-NOTICES.md ./
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "server.js"]

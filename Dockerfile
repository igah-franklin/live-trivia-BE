# ─── Stage 1: Base ───────────────────────────────────────────────────────────
FROM node:20-slim AS base
WORKDIR /app
RUN apt-get update -y && apt-get install -y openssl curl && rm -rf /var/lib/apt/lists/*
RUN groupadd -r appgroup && useradd -r -g appgroup appuser

# ─── Stage 2: Production Dependencies ────────────────────────────────────────
FROM base AS deps
COPY package*.json ./
RUN npm ci --only=production

# ─── Stage 3: Build ──────────────────────────────────────────────────────────
FROM base AS build
COPY package*.json ./
RUN npm ci
COPY . .
RUN npx prisma generate
RUN npm run build

# ─── Stage 4: Runner ─────────────────────────────────────────────────────────
FROM base AS runner
ENV NODE_ENV=production

# Copy production node_modules
COPY --from=deps /app/node_modules ./node_modules

# Copy compiled output
COPY --from=build /app/dist ./dist

# Copy Prisma schema and generated client
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/node_modules/.prisma ./node_modules/.prisma

# Non-root user for security
USER appuser

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -f http://localhost:3000/health || exit 1

CMD ["node", "dist/main.js"]

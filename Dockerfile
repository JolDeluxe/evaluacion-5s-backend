# ==========================================
# Stage 1: Builder
# ==========================================
FROM oven/bun:1 AS builder
WORKDIR /app

# Copiar manifiestos de dependencias para aprovechar la caché de capas
COPY package.json bun.lock ./

# Instalar dependencias exactas
RUN bun install --frozen-lockfile

# Copiar esquema de Prisma y código fuente
COPY prisma/ ./prisma/
COPY prisma.config.ts ./
COPY src/ ./src/

# Generar cliente de Prisma para la arquitectura Linux del contenedor
RUN bunx prisma generate

# ==========================================
# Stage 2: Runner (Producción)
# ==========================================
FROM oven/bun:1 AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

# Copiar dependencias y artefactos generados (incluye Prisma Client en node_modules o generado)
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/prisma.config.ts ./
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/src ./src

EXPOSE 3000

CMD ["bun", "run", "start"]

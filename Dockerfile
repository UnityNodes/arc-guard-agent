# ── Stage 1: Install dependencies ─────────────────────────
FROM node:22-alpine AS deps
WORKDIR /app

RUN apk add --no-cache openssl

COPY package.json package-lock.json ./
COPY packages/backend/package.json packages/backend/
COPY packages/frontend/package.json packages/frontend/
COPY packages/worker/package.json packages/worker/
COPY packages/bot/package.json packages/bot/
COPY packages/guardian-sdk/package.json packages/guardian-sdk/
COPY packages/circle-public-rpc-adapter/package.json packages/circle-public-rpc-adapter/

RUN npm ci

# ── Stage 2: Build all packages ──────────────────────────
FROM node:22-alpine AS builder
WORKDIR /app

RUN apk add --no-cache openssl

# Copy everything from deps (node_modules at all levels)
COPY --from=deps /app/ ./

# Copy source code on top
COPY packages/ packages/
COPY tsconfig*.json ./

# Generate Prisma client
RUN npx prisma generate --schema=packages/backend/prisma/schema.prisma

# Build the Guardian SDK first (backend depends on it)
RUN npm run build --workspace=packages/guardian-sdk
RUN test -f packages/guardian-sdk/dist/index.js || exit 1

# Build the circle-public-rpc-adapter - backend depends on it for bridges
# (Circle's hosted RPC returns 403 on Arc Testnet USDC balanceOf which
# breaks BridgeKit preflight; this adapter routes reads through the
# public Arc RPC instead).
RUN npm run build --workspace=packages/circle-public-rpc-adapter
RUN test -f packages/circle-public-rpc-adapter/dist/index.js || exit 1

# Build backend (tsc - ox type errors don't affect output)
RUN npm run build --workspace=packages/backend || true
RUN test -f packages/backend/dist/index.js || exit 1

# Build worker (tsc)
RUN npm run build --workspace=packages/worker

# Build bot (tsc - type warnings don't affect output)
RUN npm run build --workspace=packages/bot || true
RUN test -f packages/bot/dist/index.js || exit 1

# Build frontend (next build)
ARG NEXT_PUBLIC_API_URL
ARG NEXT_PUBLIC_CHAIN_ID=5042002
ARG NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID
ARG NEXT_PUBLIC_PRIVY_APP_ID
ARG NEXT_PUBLIC_CIRCLE_APP_ID
ARG NEXT_PUBLIC_PLAUSIBLE_DOMAIN
ARG NEXT_PUBLIC_SENTRY_DSN
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_CHAIN_ID=$NEXT_PUBLIC_CHAIN_ID
ENV NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID=$NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID
ENV NEXT_PUBLIC_PRIVY_APP_ID=$NEXT_PUBLIC_PRIVY_APP_ID
ENV NEXT_PUBLIC_CIRCLE_APP_ID=$NEXT_PUBLIC_CIRCLE_APP_ID
ENV NEXT_PUBLIC_PLAUSIBLE_DOMAIN=$NEXT_PUBLIC_PLAUSIBLE_DOMAIN
ENV NEXT_PUBLIC_SENTRY_DSN=$NEXT_PUBLIC_SENTRY_DSN

RUN npm run build --workspace=packages/frontend

# ── Stage 3: Production runtime ──────────────────────────
FROM node:22-alpine AS runner
WORKDIR /app

RUN apk add --no-cache openssl wget

RUN npm install -g @circle-fin/cli@latest

RUN addgroup -g 1001 -S guardagent && \
    adduser -S guardagent -u 1001 -h /home/guardagent && \
    mkdir -p /home/guardagent/.circle-cli && \
    chown -R guardagent:guardagent /home/guardagent

# Copy entire deps tree (root + workspace node_modules)
COPY --from=deps /app/ ./

# Copy Prisma generated client
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma
COPY --from=builder /app/packages/backend/prisma ./packages/backend/prisma

# Copy built outputs
COPY --from=builder /app/packages/guardian-sdk/dist ./packages/guardian-sdk/dist
COPY --from=builder /app/packages/circle-public-rpc-adapter/dist ./packages/circle-public-rpc-adapter/dist
COPY --from=builder /app/packages/backend/dist ./packages/backend/dist
COPY --from=builder /app/packages/worker/dist ./packages/worker/dist
COPY --from=builder /app/packages/bot/dist ./packages/bot/dist

# Copy built frontend
COPY --from=builder /app/packages/frontend/.next ./packages/frontend/.next
COPY --from=builder /app/packages/frontend/public ./packages/frontend/public
COPY --from=builder /app/packages/frontend/next.config.js ./packages/frontend/

USER guardagent

ENV NODE_ENV=production

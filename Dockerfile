FROM node:22-alpine AS builder

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@11.9.0 --activate

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/protocol/package.json ./packages/protocol/
COPY packages/daemon/package.json ./packages/daemon/
COPY packages/extension/package.json ./packages/extension/

RUN pnpm install --frozen-lockfile

COPY tsconfig.base.json ./
COPY packages/protocol ./packages/protocol
COPY packages/daemon ./packages/daemon

FROM node:22-alpine AS runner

WORKDIR /app
ENV NODE_ENV=production

RUN corepack enable && corepack prepare pnpm@11.9.0 --activate

COPY --from=builder /app /app

EXPOSE 12580

ENTRYPOINT ["pnpm", "--filter", "@latch/daemon", "start", "--", "--host", "0.0.0.0", "--port", "12580"]

# syntax=docker/dockerfile:1
FROM node:20-alpine
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

WORKDIR /repo
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/server/package.json apps/server/
COPY packages/casper-core/package.json packages/casper-core/
COPY packages/casper-guard/package.json packages/casper-guard/

RUN pnpm install --frozen-lockfile

COPY packages/casper-core packages/casper-core
COPY packages/casper-guard packages/casper-guard
COPY apps/server apps/server

RUN pnpm --filter @casper-baret/casper-core build \
 && pnpm --filter @casper-baret/casper-guard build \
 && pnpm --filter @casper-baret/server build

ENV NODE_ENV=production
EXPOSE 8080
CMD ["node", "apps/server/dist/index.js"]

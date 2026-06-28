# syntax=docker/dockerfile:1
FROM node:20-alpine
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

WORKDIR /repo

# Copy ALL workspace package.json files so pnpm can resolve the full workspace.
# (pnpm install --frozen-lockfile fails when any package listed in
# pnpm-workspace.yaml is missing its package.json from the build context.)
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/server/package.json      apps/server/
COPY apps/extension/package.json   apps/extension/
COPY apps/showcase/package.json    apps/showcase/
COPY packages/casper-core/package.json    packages/casper-core/
COPY packages/casper-guard/package.json   packages/casper-guard/
COPY packages/ext-protocol/package.json   packages/ext-protocol/
COPY packages/ui/package.json             packages/ui/
COPY packages/blackthorn-adapter/package.json packages/blackthorn-adapter/
COPY packages/showcase-ui/package.json    packages/showcase-ui/

RUN pnpm install --frozen-lockfile

# Only copy source that the server actually needs.
COPY packages/casper-core  packages/casper-core
COPY packages/casper-guard packages/casper-guard
COPY packages/ext-protocol packages/ext-protocol
COPY apps/server            apps/server

RUN pnpm --filter @casper-baret/casper-core build \
 && pnpm --filter @casper-baret/casper-guard build \
 && pnpm --filter @casper-baret/server build

ENV NODE_ENV=production
EXPOSE 8080
CMD ["node", "apps/server/dist/index.js"]

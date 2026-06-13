/**
 * Vercel serverless entry — bridges all `/api/*` requests into the Fastify app.
 *
 * The showcase frontend calls `/api/v1/analyze`, `/api/demo/scrybe`, etc.
 * Locally, Vite's dev proxy strips the `/api` prefix before forwarding to the
 * server (see apps/showcase/vite.config.ts). We reproduce that here so the
 * Fastify routes (`/v1/analyze`, `/demo/scrybe`, `/health`) match unchanged.
 *
 * We import the COMPILED server (apps/server/dist/*) rather than the TS source
 * so Vercel's function bundler resolves plain ESM `.js` imports + workspace
 * deps deterministically. `pnpm build:server` runs in the Vercel buildCommand,
 * so dist exists before this function is traced.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { buildApp } from "../apps/server/dist/app.js";
import { loadConfig } from "../apps/server/dist/config/index.js";

// Built once per cold start, reused across warm invocations.
const ready = (async () => {
  const app = await buildApp(loadConfig());
  await app.ready();
  return app;
})();

export default async function handler(
  req: IncomingMessage,
  res: ServerResponse,
) {
  const app = await ready;
  if (req.url) {
    // "/api/v1/analyze" -> "/v1/analyze"; "/api" -> "/"
    req.url = req.url.replace(/^\/api(?=\/|$)/, "") || "/";
  }
  app.server.emit("request", req, res);
}

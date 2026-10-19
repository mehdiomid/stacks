import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import rateLimit from '@fastify/rate-limit';
import { FetchError } from './net.js';
import { getPreview } from './preview.js';

const PORT = Number(process.env.PORT ?? 8080);
const HOST = process.env.HOST ?? '0.0.0.0';
const PREVIEW_PER_MINUTE = Number(process.env.PREVIEW_RATE_LIMIT ?? 60);
const here = path.dirname(fileURLToPath(import.meta.url));
const webRoot = process.env.WEB_ROOT ?? path.resolve(here, '../web');

// The browser talks to the AI provider directly and loads thumbnails from the sites themselves.
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self' data:",
  "img-src 'self' data: https: http:",
  "connect-src 'self' https://api.anthropic.com https://api.openai.com",
  "frame-ancestors 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "object-src 'none'",
].join('; ');

const app = Fastify({
  logger: { level: process.env.LOG_LEVEL ?? 'info' },
  // Request logs would contain the links people preview, so they stay off.
  disableRequestLogging: true,
  trustProxy: process.env.TRUST_PROXY === 'true',
});

app.addHook('onSend', async (_req, reply, payload) => {
  reply.header('Content-Security-Policy', CSP);
  reply.header('X-Content-Type-Options', 'nosniff');
  reply.header('Referrer-Policy', 'no-referrer');
  reply.header('X-Frame-Options', 'DENY');
  reply.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  return payload;
});

await app.register(rateLimit, { global: false });

app.get('/api/health', async () => ({ ok: true }));

app.get(
  '/api/preview',
  { config: { rateLimit: { max: PREVIEW_PER_MINUTE, timeWindow: '1 minute' } } },
  async (req, reply) => {
    const url = (req.query as { url?: string }).url;
    if (!url || url.length > 2048) return reply.code(400).send({ error: 'Send a link as ?url=' });
    try {
      const preview = await getPreview(url);
      reply.header('Cache-Control', 'private, max-age=86400');
      return preview;
    } catch (err) {
      if (err instanceof FetchError) return reply.code(err.status).send({ error: err.message });
      req.log.debug({ err }, 'preview failed');
      return reply.code(502).send({ error: 'Could not load a preview for this link.' });
    }
  },
);

if (fs.existsSync(path.join(webRoot, 'index.html'))) {
  await app.register(fastifyStatic, { root: webRoot, wildcard: false, index: ['index.html'] });
  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith('/api/')) return reply.code(404).send({ error: 'Not found' });
    return reply.sendFile('index.html');
  });
} else {
  app.log.info(`No built web app at ${webRoot}; serving the API only (use "npm run dev" for the page).`);
}

try {
  await app.listen({ port: PORT, host: HOST });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}

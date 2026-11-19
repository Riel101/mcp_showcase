import express from 'express';
import { mkdirSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createCommerce } from './node-commerce.js';
import { createHttpApp, handleHttpError, storeOrigin } from './http.js';

export interface AppOptions {
  databasePath?: string;
  baseUrl?: string;
  serveFrontend?: boolean;
  development?: boolean;
}

export async function createApp(options: AppOptions = {}) {
  const origin = storeOrigin(options.baseUrl ?? process.env.BASE_URL ?? 'http://localhost:3000');
  const baseUrl = origin.origin;
  const databasePath = options.databasePath ?? process.env.DATABASE_PATH ?? resolve('data/forme.sqlite');
  if (databasePath !== ':memory:') mkdirSync(dirname(databasePath), { recursive: true });
  const commerce = createCommerce(databasePath);
  const allowedOrigins = (process.env.MCP_ALLOWED_ORIGINS ?? '').split(',').map(value => value.trim()).filter(Boolean);
  const { app, auth } = createHttpApp(commerce, origin, allowedOrigins);
  let closeFrontend: (() => Promise<void>) | undefined;
  if (options.serveFrontend !== false) {
    const dist = resolve('dist/client');
    if (options.development) {
      const { createServer } = await import('vite');
      const vite = await createServer({ configLoader: 'runner', server: { middlewareMode: true }, appType: 'spa' });
      app.use(vite.middlewares);
      closeFrontend = () => vite.close();
    } else if (existsSync(resolve(dist, 'index.html'))) {
      app.use(express.static(dist, { maxAge: '1h', index: false }));
      app.get('/{*path}', (_req, res) => res.sendFile(resolve(dist, 'index.html')));
    } else {
      app.get('/{*path}', (_req, res) => res.status(503).type('text').send('Storefront build missing. Run npm run build, then npm start.'));
    }
  }
  app.use(handleHttpError);
  return { app, commerce, auth, baseUrl, close: async () => { await closeFrontend?.(); commerce.close(); } };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const port = Number(process.env.PORT ?? 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be a valid TCP port.');
  const instance = await createApp({ development: process.env.NODE_ENV !== 'production' && process.argv.includes('--dev') });
  const server = instance.app.listen(port, process.env.HOST ?? '127.0.0.1', () => {
    console.log(`FORME storefront: ${instance.baseUrl}`);
    console.log(`OAuth MCP endpoint: ${instance.baseUrl}/mcp`);
  });
  const stop = () => { server.close(() => { void instance.close().then(() => process.exit(0)); }); };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
}

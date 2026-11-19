import { DurableObject } from 'cloudflare:workers';
import { handleAsNodeRequest } from 'cloudflare:node';
import { createServer } from 'node:http';
import { createCommerceWithDatabase } from '../server/commerce.js';
import { createHttpApp, handleHttpError, matchesHost, storeOrigin } from '../server/http.js';
import { createDurableDatabase } from './database.js';

const storeName = 'forme-v1';
const dynamicPath = /^\/(?:api|oauth|\.well-known|mcp|health)(?:\/|$)/;

function failure(status: number, code: string, message: string): Response {
  return Response.json({ error: { code, message } }, {
    status,
    headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
  });
}

export class FormeStore extends DurableObject<Env> {
  private readonly port: number;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    const commerce = createCommerceWithDatabase(createDurableDatabase(ctx.storage));
    const allowedOrigins = env.MCP_ALLOWED_ORIGINS.split(',').map(value => value.trim()).filter(Boolean);
    const { app } = createHttpApp(commerce, storeOrigin(env.BASE_URL), allowedOrigins, 'cf-connecting-ip', url => env.ASSETS.fetch(new Request(url)));
    app.use(handleHttpError);
    // In workerd the listening port is a routing key, not a network socket.
    const server = createServer(app).listen(0);
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Could not initialize the Forme HTTP bridge.');
    this.port = address.port;
  }

  fetch(request: Request): Promise<Response> {
    return handleAsNodeRequest(this.port, request);
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!dynamicPath.test(url.pathname)) return env.ASSETS.fetch(request);

    try {
      const origin = storeOrigin(env.BASE_URL);
      const host = request.headers.get('host');
      if (url.protocol !== origin.protocol || !matchesHost(origin, url.host) || (host && !matchesHost(origin, host))) {
        return failure(403, 'INVALID_HOST', 'Use the store’s configured address.');
      }
      return await env.STORE.getByName(storeName).fetch(request);
    } catch (error) {
      console.error({ event: 'forme_worker_request_failed', type: error instanceof Error ? error.name : 'UnknownError' });
      return failure(503, 'SERVICE_UNAVAILABLE', 'Forme is temporarily unavailable. Please try again.');
    }
  },
} satisfies ExportedHandler<Env>;

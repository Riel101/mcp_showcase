import express, { type ErrorRequestHandler } from 'express';
import { CommerceError, type Commerce } from './commerce.js';
import { createAuth } from './auth.js';
import { mountMcp } from './mcp.js';

export function storeOrigin(baseUrl: string): URL {
  const origin = new URL(baseUrl);
  if (!['http:', 'https:'].includes(origin.protocol) || origin.pathname !== '/' || origin.search || origin.hash || origin.username || origin.password) {
    throw new Error('BASE_URL must be an HTTP(S) origin, without a path, query, or credentials.');
  }
  if (origin.protocol !== 'https:' && !['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname)) {
    throw new Error('Non-loopback deployments require an HTTPS BASE_URL.');
  }
  return origin;
}

export function matchesHost(origin: URL, host: string): boolean {
  const port = origin.port ? `:${origin.port}` : '';
  return host.toLowerCase() === origin.host
    || (['localhost', '127.0.0.1'].includes(origin.hostname) && [`localhost${port}`, `127.0.0.1${port}`].includes(host.toLowerCase()));
}

export function createHttpApp(commerce: Commerce, origin: URL, allowedOrigins: string[] = [], trustedClientIpHeader?: string) {
  const baseUrl = origin.origin;
  const auth = createAuth(commerce, { baseUrl, allowedOrigins, trustedClientIpHeader });
  const app = express();
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    if (!req.headers.host || !matchesHost(origin, req.headers.host)) {
      res.status(403).json({ error: { code: 'INVALID_HOST', message: 'Unrecognized request host.' } });
      return;
    }
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', "frame-ancestors 'none'; object-src 'none'; base-uri 'self'");
    if (origin.protocol === 'https:') res.setHeader('Strict-Transport-Security', 'max-age=31536000');
    if (req.path.startsWith('/api') || req.path.startsWith('/oauth')) res.setHeader('Cache-Control', 'no-store');
    next();
  });
  app.use(express.json({ limit: '64kb' }));
  app.use(express.urlencoded({ extended: false, limit: '16kb' }));
  app.get('/health', (_req, res) => res.json({ status: 'ok', service: 'forme' }));
  app.use(auth.router);
  mountMcp(app, commerce, auth, { baseUrl });
  app.get('/api/products', (req, res) => {
    const input: Record<string, unknown> = {};
    for (const key of ['query', 'category', 'sort']) if (typeof req.query[key] === 'string') input[key] = req.query[key];
    for (const key of ['minPrice', 'maxPrice', 'limit', 'offset']) if (typeof req.query[key] === 'string') input[key] = Number(req.query[key]);
    if (req.query.inStock !== undefined) input.inStock = req.query.inStock === 'true';
    res.json(commerce.execute('discover_products', input));
  });
  app.get('/api/products/:id', (req, res) => res.json(commerce.execute('inspect_products', { productIds: [req.params.id] })));
  app.post('/api/actions/:action', (req, res) => {
    if ((req.headers.origin && req.headers.origin !== baseUrl) || req.headers['sec-fetch-site'] === 'cross-site') {
      res.status(403).json({ error: { code: 'ORIGIN_REJECTED', message: 'Use this store’s own window for account actions.' } });
      return;
    }
    if (!req.is('application/json') || !req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
      res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'Send a JSON object.' } });
      return;
    }
    const user = auth.sessionUser(req);
    res.json(commerce.execute(String(req.params.action), req.body, user?.id));
  });
  app.use('/api', (_req, res) => res.status(404).json({ error: { code: 'NOT_FOUND', message: 'This service route does not exist.' } }));
  app.use('/oauth', (_req, res) => res.status(404).json({ error: 'invalid_request', error_description: 'Unknown authorization route.' }));
  return { app, auth };
}

export const handleHttpError: ErrorRequestHandler = (error, _req, res, _next) => {
  if (res.headersSent) return;
  if (error instanceof CommerceError) {
    res.status(error.status).json({ error: { code: error.code, message: error.message } });
  } else if (error.type === 'entity.parse.failed' || error.type === 'entity.too.large') {
    res.status(error.type === 'entity.too.large' ? 413 : 400).json({ error: { code: 'INVALID_INPUT', message: 'Request body is invalid or too large.' } });
  } else {
    console.error('[forme] Request failed:', error instanceof Error ? error.message : 'Unknown error');
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'We could not complete that action. Please try again.' } });
  }
};

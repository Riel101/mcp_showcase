import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const baseUrl = new URL(process.argv[2] ?? 'http://localhost:8787').origin;
const resource = `${baseUrl}/mcp`;
const cookies = new Map();

async function request(path, options = {}) {
  const headers = new Headers(options.headers);
  if (!headers.has('Origin')) headers.set('Origin', baseUrl);
  if (!headers.has('Cookie') && cookies.size) {
    headers.set('Cookie', [...cookies].map(([key, value]) => `${key}=${value}`).join('; '));
  }
  const response = await fetch(new URL(path, baseUrl), {
    redirect: 'manual', signal: AbortSignal.timeout(15_000), ...options, headers,
  });
  for (const header of response.headers.getSetCookie()) {
    const pair = header.split(';', 1)[0];
    const separator = pair.indexOf('=');
    cookies.set(pair.slice(0, separator), pair.slice(separator + 1));
  }
  return response;
}

const json = (path, body) => request(path, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});
const form = (path, body) => request(path, {
  method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(body),
});
const action = (name, body) => json(`/api/actions/${name}`, body);

async function expectStatus(response, status, step) {
  if (response.status !== status) {
    const detail = await response.json().catch(() => null);
    const code = detail?.error?.code ?? (typeof detail?.error === 'string' ? detail.error : '');
    assert.fail(`${step}: expected HTTP ${status}, received ${response.status}${code ? ` (${code})` : ''}`);
  }
  return response;
}
const requireJson = async (response, status, step) => (await expectStatus(response, status, step)).json();

const home = await expectStatus(await request('/', { headers: { 'Sec-Fetch-Mode': 'navigate' } }), 200, 'Storefront');
assert.match(await home.text(), /<title>FORME/);
const deepLink = await expectStatus(await request('/product/daily-mug', { headers: { 'Sec-Fetch-Mode': 'navigate' } }), 200, 'Storefront deep link');
assert.match(await deepLink.text(), /<title>FORME/);
const photo = await expectStatus(await request('/images/daily-mug.webp'), 200, 'Product image');
assert.match(photo.headers.get('content-type') ?? '', /image\/webp/);
assert.ok((await photo.arrayBuffer()).byteLength > 0);
assert.equal((await requireJson(await request('/health'), 200, 'Health check')).status, 'ok');
const { products } = await requireJson(await request('/api/products?query=mug'), 200, 'Product search');
assert.ok(products.some(product => product.id === 'daily-mug'));

const protectedResource = await requireJson(await request('/.well-known/oauth-protected-resource/mcp'), 200, 'MCP protected resource metadata');
assert.equal(protectedResource.resource, resource);
const challenge = await expectStatus(await request('/mcp'), 401, 'Unauthenticated MCP request');
assert.match(challenge.headers.get('www-authenticate') ?? '', /resource_metadata=/);
assert.match(challenge.headers.get('cache-control') ?? '', /no-store/);
await expectStatus(await request('/api/actions/manage_cart', {
  method: 'POST',
  headers: { Origin: 'https://untrusted.example', 'Content-Type': 'application/json' },
  body: JSON.stringify({ operation: 'view' }),
}), 403, 'Cross-origin action');
await expectStatus(await request('/api/actions/get_account', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ payload: 'a'.repeat(65_536) }),
}), 413, 'Oversize JSON');
console.log('Static assets, catalog, host routes, and request limits passed.');

const password = 'Workerd-smoke-' + randomBytes(24).toString('hex');
const email = `workerd-${randomUUID()}@example.test`;
const registered = await expectStatus(await json('/api/auth/register', { name: 'Worker Smoke Test', email, password }), 201, 'Browser registration');
assert.match(registered.headers.get('set-cookie') ?? '', /HttpOnly/i);
if (baseUrl.startsWith('https:')) assert.match(registered.headers.get('set-cookie') ?? '', /; Secure/i);
await expectStatus(await json('/api/auth/logout', {}), 200, 'Browser logout');
await expectStatus(await json('/api/auth/login', { email, password }), 200, 'Browser login');
const account = await requireJson(await action('get_account', {}), 200, 'Browser account');
assert.equal(account.balance, 250000);

const callback = 'http://127.0.0.1:54321/callback';
const registration = await requireJson(await json('/oauth/register', {
  client_name: 'Forme Workerd Smoke Test',
  redirect_uris: [callback],
  token_endpoint_auth_method: 'none',
}), 201, 'OAuth client registration');
const clientId = registration.client_id;
const verifier = randomBytes(48).toString('base64url');
const state = randomUUID();
const params = new URLSearchParams({
  client_id: clientId, redirect_uri: callback, response_type: 'code', scope: 'commerce:read commerce:write',
  code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256',
  resource, state,
});
const page = await expectStatus(await request('/oauth/authorize?' + params), 200, 'OAuth consent page');
const consent = (await page.text()).match(/name="request" value="([A-Za-z0-9_-]+)"/)?.[1];
assert.ok(consent, 'Expected a browser-bound consent form');
const approved = await expectStatus(await form('/oauth/authorize', { request: consent, decision: 'allow' }), 303, 'OAuth approval');
const redirect = new URL(approved.headers.get('location'));
assert.equal(redirect.searchParams.get('state'), state);
assert.equal(redirect.origin + redirect.pathname, callback);
const tokens = await requireJson(await form('/oauth/token', {
  client_id: clientId, code: redirect.searchParams.get('code'), code_verifier: verifier,
  redirect_uri: callback, resource, grant_type: 'authorization_code',
}), 200, 'OAuth PKCE token exchange');

const transport = new StreamableHTTPClientTransport(new URL(resource), {
  requestInit: { headers: { Authorization: 'Bearer ' + tokens.access_token } },
});
const client = new Client({ name: 'forme-workerd-smoke', version: '1.0.0' });
async function call(name, args = {}) {
  const result = await client.callTool({ name, arguments: args }, undefined, { timeout: 15_000 });
  assert.ok(!result.isError, `${name}: ${result.structuredContent?.error?.message ?? 'tool failed'}`);
  assert.ok(result.structuredContent, `${name}: expected structured data`);
  return result.structuredContent;
}

try {
  await client.connect(transport, { timeout: 15_000 });
  const { tools } = await client.listTools();
  assert.ok(tools.some(tool => tool.name === 'prepare_checkout'));
  const discovery = await call('discover_products', { limit: 16 });
  for (const product of discovery.products) {
    const details = await requireJson(await request('/api/products/' + product.id), 200, 'Website product');
    assert.equal(product.image, new URL(details.products[0].images[0], baseUrl).href, 'Discovery must use the storefront photo');
    const photo = await expectStatus(await request(product.image), 200, 'Discovery photo');
    assert.match(photo.headers.get('content-type') ?? '', /image\/webp/);
  }
  console.log('Discovery images match storefront product images.');
  const cart = await call('manage_cart', { operation: 'add', items: [{ productId: 'daily-mug', quantity: 1 }] });
  assert.equal(cart.itemCount, 1);
  const browserCart = await requireJson(await action('manage_cart', { operation: 'view' }), 200, 'Shared browser cart');
  assert.equal(browserCart.itemCount, 1);
  assert.equal(browserCart.items[0].productId, cart.items[0].productId);

  const quote = await call('prepare_checkout', {
    shippingAddress: { name: 'Worker Smoke Test', line1: '12 Studio Lane', city: 'Portland', region: 'Oregon', postalCode: '97201', country: 'United States' },
    shippingMethod: 'standard',
  });
  assert.ok(quote.canPlaceOrder);
  const orderInput = { quoteId: quote.quoteId, idempotencyKey: randomUUID() };
  const placed = await call('place_order', orderInput);
  assert.equal(placed.balance, 250000 - quote.cart.total);
  const replay = await call('place_order', orderInput);
  assert.equal(replay.order.id, placed.order.id);
  const history = await requireJson(await action('track_orders', {}), 200, 'Browser order history');
  assert.equal(history.orders[0].id, placed.order.id);
  const cancelled = await requireJson(await action('change_order', {
    orderId: placed.order.id, operation: 'cancel', reason: 'End of workerd smoke test',
  }), 200, 'Order cancellation');
  assert.equal(cancelled.order.status, 'cancelled');
  assert.equal((await call('get_account')).balance, 250000);

  const { connections } = await requireJson(await request('/api/auth/connections'), 200, 'Browser connected agents');
  assert.equal(connections.length, 1);
  await expectStatus(await request('/api/auth/connections/' + encodeURIComponent(connections[0].id), { method: 'DELETE' }), 204, 'Connection revocation');
  await expectStatus(await request('/mcp', { headers: { Authorization: 'Bearer ' + tokens.access_token } }), 401, 'Revoked access token');
} finally {
  await client.close();
}

console.log('Browser registration, login, OAuth PKCE, MCP tooling, shared cart, idempotent checkout, cancellation, and revocation passed.');

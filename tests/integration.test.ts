import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request as httpRequest } from 'node:http';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createApp } from '../src/server/index.js';
import type { Cart, CheckoutQuote, Order, Product, Profile } from '../src/shared/commerce.js';

async function fixture() {
  const server = createServer();
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const instance = await createApp({ baseUrl, databasePath: ':memory:', serveFrontend: false });
  server.on('request', instance.app);
  const cookies = new Map<string, string>();
  async function request(path: string, init: RequestInit = {}) {
    const headers = new Headers(init.headers);
    headers.set('Origin', baseUrl);
    if (!headers.has('Cookie')) headers.set('Cookie', [...cookies].map(([k, v]) => `${k}=${v}`).join('; '));
    const response = await fetch(baseUrl + path, { ...init, headers, redirect: 'manual' });
    for (const entry of response.headers.getSetCookie()) {
      const pair = entry.split(';')[0];
      const split = pair.indexOf('=');
      cookies.set(pair.slice(0, split), pair.slice(split + 1));
    }
    return response;
  }
  async function json(path: string, body: unknown) {
    return request(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  }
  async function authorize(scope = 'commerce:read commerce:write') {
    const callback = 'http://127.0.0.1:54321/callback';
    const registered = await json('/oauth/register', { client_name: 'Integration shopping assistant', redirect_uris: [callback], token_endpoint_auth_method: 'none' });
    assert.equal(registered.status, 201);
    const { client_id } = await registered.json() as { client_id: string };
    const verifier = randomBytes(48).toString('base64url');
    const query = new URLSearchParams({ client_id, redirect_uri: callback, response_type: 'code', code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256', scope, resource: baseUrl + '/mcp', state: 'integration-state' });
    const consent = await request('/oauth/authorize?' + query);
    assert.equal(consent.status, 200);
    const html = await consent.text();
    const pending = html.match(/name="request" value="([A-Za-z0-9_-]+)"/)?.[1];
    assert.ok(pending, 'Authorization must render a browser-bound consent form.');
    const approved = await request('/oauth/authorize', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ request: pending, decision: 'allow' }) });
    assert.equal(approved.status, 303);
    const location = new URL(approved.headers.get('Location')!);
    assert.equal(location.searchParams.get('state'), 'integration-state');
    return { client_id, code: location.searchParams.get('code')!, code_verifier: verifier, redirect_uri: callback, resource: baseUrl + '/mcp' };
  }
  async function oauth(scope = 'commerce:read commerce:write') {
    const details = await authorize(scope);
    const exchanged = await request('/oauth/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'authorization_code', ...details }) });
    assert.equal(exchanged.status, 200);
    return { ...await exchanged.json() as { access_token: string; refresh_token: string }, ...details };
  }
  return { ...instance, request, json, oauth, authorize, cookies, stop: async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    await instance.close();
  } };
}

function resultData<T>(result: Awaited<ReturnType<Client['callTool']>>): T {
  assert.ok(!result.isError, JSON.stringify(result));
  if (result.structuredContent) return result.structuredContent as T;
  const content = result.content as Array<{ type: string; text?: string }>;
  const text = content.find(item => item.type === 'text')?.text;
  assert.ok(text);
  return JSON.parse(text) as T;
}

test('OAuth-authorized MCP shopping and browser share a single persistent customer state', async t => {
  const f = await fixture();
  t.after(f.stop);
  const registration = await f.json('/api/auth/register', { name: 'Alex Shopper', email: 'alex@example.test', password: 'correct-horse-forms-123' });
  assert.equal(registration.status, 201);
  const token = await f.oauth();
  const client = new Client({ name: 'forme-integration', version: '1.0.0' });
  const transport = new StreamableHTTPClientTransport(new URL(f.baseUrl + '/mcp'), { requestInit: { headers: { Authorization: 'Bearer ' + token.access_token } } });
  await client.connect(transport);
  t.after(() => client.close());
  const tools = await client.listTools();
  assert.ok(JSON.stringify(tools).length < 24000, "Tool discovery must remain compact.");
  for (const name of ['discover_products', 'inspect_products', 'manage_cart', 'prepare_checkout', 'place_order', 'track_orders', 'request_return', 'contact_support']) assert.ok(tools.tools.some(tool => tool.name === name), name);
  const call = async <T>(name: string, args: Record<string, unknown> = {}) => resultData<T>(await client.callTool({ name, arguments: args }));
  const catalog = await call<{ products: Product[] }>('discover_products', { limit: 3 });
  assert.ok(catalog.products.length > 0 && catalog.products.length <= 3);
  const product = catalog.products[0];
  const cart = await call<Cart>('manage_cart', { operation: 'add', items: [{ productId: product.id, quantity: 1 }] });
  assert.equal(cart.itemCount, 1);
  const browserCart = await f.json('/api/actions/manage_cart', { operation: 'view' });
  const webCart = await browserCart.json() as Cart;
  assert.deepEqual({ ...webCart, items: webCart.items.map(item => ({ ...item, image: new URL(item.image, f.baseUrl).href })) }, cart);
  const quote = await call<CheckoutQuote>('prepare_checkout', { shippingAddress: { name: 'Alex Shopper', line1: '12 Studio Lane', city: 'Lagos', region: 'Lagos', postalCode: '100001', country: 'Nigeria' }, shippingMethod: 'standard' });
  assert.equal(quote.canPlaceOrder, true);
  const key = randomUUID();
  const placed = await call<{ order: Order; balance: number }>('place_order', { quoteId: quote.quoteId, idempotencyKey: key });
  assert.equal(placed.order.total, quote.cart.total);
  const replay = await call<{ order: Order; balance: number }>('place_order', { quoteId: quote.quoteId, idempotencyKey: key });
  assert.equal(replay.order.id, placed.order.id);
  const orders = await (await f.json('/api/actions/track_orders', {})).json() as { orders: Order[] };
  assert.equal(orders.orders.length, 1);
  assert.equal(orders.orders[0].id, placed.order.id);
  const cleared = await (await f.json('/api/actions/manage_cart', { operation: 'view' })).json() as Cart;
  assert.equal(cleared.itemCount, 0);
  const profile = await call<Profile>('get_account');
  assert.equal(profile.balance, 250000 - placed.order.total);
  const ticket = await call<{ ticket: { id: string } }>('contact_support', { orderId: placed.order.id, subject: 'Delivery instructions', message: 'Please leave with reception.' });
  const cases = await (await f.json('/api/actions/list_support_requests', {})).json() as { tickets: Array<{ id: string }> };
  assert.equal(cases.tickets[0].id, ticket.ticket.id);
  const connections = await (await f.request('/api/auth/connections')).json() as { connections: Array<{ id: string }> };
  assert.equal(connections.connections.length, 1);
  const revoked = await f.request('/api/auth/connections/' + connections.connections[0].id, { method: 'DELETE' });
  assert.equal(revoked.status, 204);
  const denied = await fetch(f.baseUrl + '/mcp', { method: 'POST', headers: { Authorization: 'Bearer ' + token.access_token, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: 9, method: 'tools/list' }) });
  assert.equal(denied.status, 401);
});

test('HTTP boundaries protect customer data and reject malformed/cross-origin writes', async t => {
  const f = await fixture();
  t.after(f.stop);
  assert.equal((await f.request('/health')).status, 200);
  assert.equal((await f.request('/api/products')).status, 200);
  assert.equal((await f.json('/api/actions/manage_cart', { operation: 'view' })).status, 401);
  const unauthenticated = await fetch(f.baseUrl + '/mcp', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(unauthenticated.status, 401);
  assert.match(unauthenticated.headers.get('www-authenticate') ?? '', /resource_metadata=/);
  const crossOrigin = await fetch(f.baseUrl + '/api/actions/manage_cart', { method: 'POST', headers: { Origin: 'https://evil.example', 'Content-Type': 'application/json' }, body: JSON.stringify({ operation: 'clear' }) });
  assert.equal(crossOrigin.status, 403);
  const invalid = await f.request('/api/actions/manage_cart', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{' });
  assert.equal(invalid.status, 400);
  const hostileStatus = await new Promise<number | undefined>((resolve, reject) => { const req = httpRequest(f.baseUrl + '/health', { headers: { Host: 'evil.example' } }, res => { res.resume(); resolve(res.statusCode); }); req.on('error', reject); req.end(); });
  assert.equal(hostileStatus, 403);
});

async function registerCustomer(f: Awaited<ReturnType<typeof fixture>>) {
  assert.equal((await f.json('/api/auth/register', {name:'OAuth Shopper',email:'oauth@example.test',password:'long-password-for-tests'})).status,201);
}
async function tokenRequest(f: Awaited<ReturnType<typeof fixture>>, fields: Record<string,string>) {
 return f.request('/oauth/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams(fields)});
}
async function mcpRequest(f: Awaited<ReturnType<typeof fixture>>, token: string, name = 'get_account', args: Record<string,unknown> = {}) {
 return fetch(f.baseUrl+'/mcp',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json',Accept:'application/json, text/event-stream'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:args}})});
}
test('PKCE, resource binding and one-time authorization codes are enforced',async t=>{
 const f=await fixture();t.after(f.stop);await registerCustomer(f);const grant=await f.authorize();
 const wrongVerifier=await tokenRequest(f,{grant_type:'authorization_code',...grant,code_verifier:'x'.repeat(64)});assert.equal(wrongVerifier.status,400);assert.equal((await wrongVerifier.json() as {error:string}).error,'invalid_grant');
 const wrongResource=await tokenRequest(f,{grant_type:'authorization_code',...grant,resource:'https://other.example/mcp'});assert.equal(wrongResource.status,400);assert.equal((await wrongResource.json() as {error:string}).error,'invalid_target');
 const good=await tokenRequest(f,{grant_type:'authorization_code',...grant});assert.equal(good.status,200);const token=await good.json() as {access_token:string};assert.equal((await mcpRequest(f,token.access_token)).status,200);
 const replay=await tokenRequest(f,{grant_type:'authorization_code',...grant});assert.equal(replay.status,400);assert.equal((await mcpRequest(f,token.access_token)).status,401);
});
test('read-only OAuth connections cannot mutate via mixed-operation tools',async t=>{
 const f=await fixture();t.after(f.stop);await registerCustomer(f);const token=await f.oauth('commerce:read');
 assert.equal((await mcpRequest(f,token.access_token,'manage_cart',{operation:'view'})).status,200);
 const denied=await mcpRequest(f,token.access_token,'manage_cart',{operation:'add',items:[{productId:'daily-mug',quantity:1}]});assert.equal(denied.status,403);assert.match(denied.headers.get('www-authenticate')??'',/insufficient_scope/);
 assert.equal((await mcpRequest(f,token.access_token,'manage_review',{operation:'submit',productId:'daily-mug',rating:5,title:'x',body:'x'})).status,403);
 assert.equal((await f.json('/api/actions/manage_cart',{operation:'view'})).status,200);
});
test('refresh tokens rotate, cannot increase scope, and reuse revokes the grant',async t=>{
 const f=await fixture();t.after(f.stop);await registerCustomer(f);const token=await f.oauth('commerce:read');
 const fields={grant_type:'refresh_token',client_id:token.client_id,refresh_token:token.refresh_token,resource:token.resource};
 const escalate=await tokenRequest(f,{...fields,scope:'commerce:read commerce:write'});assert.equal(escalate.status,400);assert.equal((await escalate.json() as {error:string}).error,'invalid_scope');
 const refreshed=await tokenRequest(f,fields);assert.equal(refreshed.status,200);const next=await refreshed.json() as {access_token:string;refresh_token:string};assert.notEqual(next.refresh_token,token.refresh_token);assert.equal((await mcpRequest(f,next.access_token)).status,200);
 assert.equal((await tokenRequest(f,fields)).status,400);assert.equal((await mcpRequest(f,next.access_token)).status,401);
});
test('redirect validation, consent binding and browser-origin protections reject hostile requests',async t=>{
 const f=await fixture();t.after(f.stop);await registerCustomer(f);
 for(const uri of ['javascript:alert(1)','http://attacker.example/callback','https://safe.example/callback#fragment']) assert.equal((await f.json('/oauth/register',{redirect_uris:[uri]})).status,400);
 const registered=await f.json('/oauth/register',{redirect_uris:['http://localhost:43321/callback'],token_endpoint_auth_method:'none'});const client=await registered.json() as {client_id:string};
 const query=new URLSearchParams({client_id:client.client_id,redirect_uri:'https://attacker.example/callback',response_type:'code',resource:f.baseUrl+'/mcp',code_challenge:'a'.repeat(43),code_challenge_method:'S256'});
 const openRedirect=await f.request('/oauth/authorize?'+query);assert.equal(openRedirect.status,400);assert.equal(openRedirect.headers.get('location'),null);
 query.set('redirect_uri','http://localhost:43321/callback');const consent=await f.request('/oauth/authorize?'+query);assert.equal(consent.status,200);const pending=(await consent.text()).match(/name="request" value="([A-Za-z0-9_-]+)"/)![1];
 const unbound=await f.request('/oauth/authorize',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded',Cookie:''},body:new URLSearchParams({request:pending,decision:'allow'})});assert.equal(unbound.status,400);
 const csrf=await fetch(f.baseUrl+'/api/auth/logout',{method:'POST',headers:{Origin:'https://attacker.example',Cookie:[...f.cookies].map(([k,v])=>`${k}=${v}`).join('; ')}});assert.equal(csrf.status,403);
 const session=await (await f.request('/api/session')).json() as {user:unknown};assert.ok(session.user);
 const grant=await f.oauth();const originDenied=await fetch(f.baseUrl+'/mcp',{method:'POST',headers:{Origin:'https://untrusted.example',Authorization:'Bearer '+grant.access_token,'Content-Type':'application/json'},body:'{}'});assert.equal(originDenied.status,403);
});

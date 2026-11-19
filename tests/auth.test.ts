import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import test from "node:test";
import { createApp } from "../src/server/index.ts";

async function authFixture() {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const origin = `http://127.0.0.1:${address.port}`;
  const resource = origin + "/mcp";
  const instance = await createApp({ baseUrl: origin, databasePath: ":memory:", serveFrontend: false });
  server.on("request", instance.app);

  function browser() {
    const cookies = new Map<string, string>();
    async function request(path: string, init: RequestInit = {}) {
      const headers = new Headers(init.headers);
      if (!headers.has("Origin")) headers.set("Origin", origin);
      if (cookies.size) headers.set("Cookie", [...cookies].map(([name, value]) => `${name}=${value}`).join("; "));
      const response = await fetch(origin + path, { ...init, headers, redirect: "manual" });
      for (const header of response.headers.getSetCookie()) {
        const pair = header.split(";", 1)[0];
        const equals = pair.indexOf("=");
        cookies.set(pair.slice(0, equals), pair.slice(equals + 1));
      }
      return response;
    }

    function json(path: string, body: unknown) {
      return request(path, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
    }

    function form(path: string, data: Record<string, string>, headers?: HeadersInit) {
      return request(path, { method: "POST", headers, body: new URLSearchParams(data) });
    }
    return { request, json, form };
  }

  async function stop() {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    await instance.close();
  }
  return { browser, origin, resource, stop, commerce: instance.commerce };
}

function takeRequest(html: string) {
  const hidden = html.match(/name="request" value="([A-Za-z0-9_-]{43})"/)?.[1];
  assert.ok(hidden, "The OAuth page includes a browser-bound request.");
  return hidden;
}

function authorizationPath(clientId: string, redirectUri: string, resource: string, verifier: string) {
  return "/oauth/authorize?" + new URLSearchParams({
    client_id: clientId, redirect_uri: redirectUri, resource, code_challenge_method: "S256",
    code_challenge: createHash("sha256").update(verifier).digest("base64url"),
    response_type: "code", scope: "commerce:read", state: "résumé-7",
  });
}

test("signed-out agent clients can create an account in the authorization flow and cancel without creating a grant", async t => {
  const f = await authFixture();
  t.after(f.stop);
  const browser = f.browser();
  const registered = await browser.json("/oauth/register", {
    client_name: 'Desk Helper <img src="x">', redirect_uris: ["http://127.0.0.1:17200/login-callback"],
    token_endpoint_auth_method: "none",
  });
  assert.equal(registered.status, 201);
  const { client_id } = await registered.json() as { client_id: string };
  const callback = "http://127.0.0.1:17237/login-callback";
  const verifier = randomBytes(48).toString("base64url");
  const path = authorizationPath(client_id, callback, f.resource, verifier);
  const response = await browser.request(path);
  assert.equal(response.status, 200);
  const signIn = await response.text();
  assert.match(signIn, /Sign in to Forme/);
  assert.match(signIn, /&lt;img src=&quot;x&quot;&gt;/);
  const request = takeRequest(signIn);
  const beforeSignIn = await browser.form("/oauth/authorize", { request, decision: "allow" });
  assert.equal(beforeSignIn.status, 401);

  const password = "very-long-strong-password";
  const signup = await browser.form("/oauth/authorize", {
    request, decision: "register", email: "New@Example.Test", name: "New Shopper", password,
  });
  assert.equal(signup.status, 200);
  assert.match(signup.headers.get("set-cookie") ?? "", /HttpOnly; SameSite=Lax/i);
  assert.match(await signup.text(), /Connect your agent/);
  const account = await (await browser.request("/api/session")).json() as { user: { id: string; email: string } };
  assert.equal(account.user.email, "new@example.test");
  const stored = f.commerce.db.prepare("SELECT password_hash, password_salt FROM auth_users WHERE id = ?").get(account.user.id);
  assert.equal(String(stored?.password_hash).length, 86);
  assert.equal(String(stored?.password_salt).length, 43);
  assert.notEqual(stored?.password_hash, password);

  const cancelled = await browser.form("/oauth/authorize", { request, decision: "deny" });
  assert.equal(cancelled.status, 303);
  const redirect = new URL(cancelled.headers.get("location")!);
  assert.equal(redirect.origin + redirect.pathname, callback);
  assert.equal(redirect.searchParams.get("state"), "résumé-7");
  assert.equal(redirect.searchParams.get("iss"), f.origin);
  assert.equal(redirect.searchParams.get("error"), "access_denied");
  assert.equal(redirect.searchParams.get("code"), null);
  assert.deepEqual(await (await browser.request("/api/auth/connections")).json(), { connections: [] });
  assert.equal((await browser.form("/oauth/authorize", { request, decision: "allow" })).status, 400);

  assert.equal((await browser.request("/api/auth/logout", { method: "POST" })).status, 200);
  const restarted = takeRequest(await (await browser.request(path)).text());
  const signInAgain = await browser.form("/oauth/authorize", {
    request: restarted, decision: "login", email: account.user.email, password,
  });
  assert.equal(signInAgain.status, 200);
  assert.match(await signInAgain.text(), /Connect your agent/);
});

test("authorization codes bind to the exact callback and client, and grants revoke only for their owner", async t => {
  const f = await authFixture();
  t.after(f.stop);
  const owner = f.browser();
  const stranger = f.browser();
  for (const [browser, email] of [[owner, "owner@example.test"], [stranger, "stranger@example.test"]] as const) {
    const response = await browser.json("/api/auth/register", { name: email, email, password: "strong-test-password" });
    assert.equal(response.status, 201);
  }
  const callback = "https://agent.example.test/oauth/callback?channel=shopping";
  const clientResponse = await owner.json("/oauth/register", {
    client_name: "Desk Helper", redirect_uris: [callback], token_endpoint_auth_method: "client_secret_basic",
  });
  assert.equal(clientResponse.status, 201);
  const client = await clientResponse.json() as { client_id: string; client_secret: string };
  const verifier = randomBytes(48).toString("base64url");
  const mismatch = await owner.request(authorizationPath(client.client_id, callback + "&other=1", f.resource, verifier));
  assert.equal(mismatch.status, 400);
  assert.equal(mismatch.headers.has("location"), false);
  const invalidScope = await owner.request(
    authorizationPath(client.client_id, callback, f.resource, verifier)
      .replace("scope=commerce%3Aread", "scope=unknown"),
  );
  assert.equal(invalidScope.status, 400);
  assert.equal(invalidScope.headers.has("location"), false);

  const display = await owner.request(authorizationPath(client.client_id, callback, f.resource, verifier));
  assert.equal(display.status, 200);
  const pending = takeRequest(await display.text());
  const wrongOwner = await stranger.form("/oauth/authorize", { request: pending, decision: "allow" });
  assert.equal(wrongOwner.status, 400);
  const consent = await owner.form("/oauth/authorize", { request: pending, decision: "allow" });
  assert.equal(consent.status, 303);
  const location = new URL(consent.headers.get("location")!);
  assert.equal(location.searchParams.get("channel"), "shopping");
  const code = location.searchParams.get("code")!;
  assert.ok(code);
  const tokenRequest = {
    grant_type: "authorization_code", code, code_verifier: verifier, redirect_uri: callback, resource: f.resource,
  };
  const basic = (secret: string) => "Basic " + Buffer.from(`${client.client_id}:${secret}`).toString("base64");
  const wrongClient = await owner.form("/oauth/token", tokenRequest, { Authorization: basic("bad-secret") });
  assert.equal(wrongClient.status, 401);
  const wrongRedirect = await owner.form("/oauth/token", { ...tokenRequest, redirect_uri: callback + "&other=1" }, { Authorization: basic(client.client_secret) });
  assert.equal(wrongRedirect.status, 400);
  assert.equal((await wrongRedirect.json() as { error: string }).error, "invalid_grant");
  const agentOrigin = new URL(callback).origin;
  const issued = await owner.form("/oauth/token", tokenRequest, {
    Authorization: basic(client.client_secret), Origin: agentOrigin,
  });
  assert.equal(issued.status, 200);
  assert.equal(issued.headers.get("Access-Control-Allow-Origin"), agentOrigin);
  const { access_token, refresh_token } = await issued.json() as { access_token: string; refresh_token: string };
  const blockedOrigin = await owner.request("/mcp", {
    headers: { Authorization: "Bearer " + access_token, Origin: agentOrigin },
  });
  assert.equal(blockedOrigin.status, 403, "Registration alone cannot bypass the MCP browser origin allowlist.");
  const listing = await (await owner.request("/api/auth/connections")).json() as {
    connections: { id: string; clientName: string; scopes: string[] }[];
  };
  assert.equal(listing.connections.length, 1);
  const connection = listing.connections[0];
  assert.equal(connection.clientName, "Desk Helper");
  assert.deepEqual(connection.scopes, ["commerce:read"]);
  assert.deepEqual(await (await stranger.request("/api/auth/connections")).json(), { connections: [] });
  assert.equal((await stranger.request("/api/auth/connections/" + connection.id, { method: "DELETE" })).status, 404);
  assert.equal((await owner.request("/api/auth/connections/" + connection.id, {
    method: "DELETE", headers: { Origin: "https://outside.example" },
  })).status, 403);
  const revoked = await owner.form("/oauth/revoke", { token: refresh_token }, { Authorization: basic(client.client_secret) });
  assert.equal(revoked.status, 200);
  const denied = await owner.request("/mcp", { method: "GET", headers: { Authorization: "Bearer " + access_token } });
  assert.equal(denied.status, 401);
  assert.match(denied.headers.get("WWW-Authenticate") ?? "", /invalid_token/);
  assert.deepEqual(await (await owner.request("/api/auth/connections")).json(), { connections: [] });
});

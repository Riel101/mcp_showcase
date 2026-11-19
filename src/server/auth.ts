import { createHash, randomBytes, randomUUID, scrypt, timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";
import express, { type Request, type Response } from "express";
import { z } from "zod";
import type { Commerce } from "./commerce.ts";

export const readScope = "commerce:read";
export const writeScope = "commerce:write";
const scopes = [readScope, writeScope] as const;
const authMethods = ["none", "client_secret_basic", "client_secret_post"] as const;
const grantTypes = ["authorization_code", "refresh_token"] as const;
const minute = 60_000;
const day = 1_440 * minute;
const sessionLifetime = 7 * day;
const consentLifetime = 15 * minute;
const codeLifetime = 5 * minute;
const accessLifetime = 15 * minute;
const grantLifetime = 30 * day;
const sessionCookie = "forme_session";
const consentCookie = "forme_oauth";
const opaque = /^[A-Za-z0-9_-]{43}$/;
const verifierPattern = /^[A-Za-z0-9._~-]{43,128}$/;
const tokenUrlencoded = express.urlencoded({ extended: false, limit: "16kb", parameterLimit: 25 });
const jsonBody = express.json({ limit: "16kb" });

type Scope = typeof scopes[number];
type AuthMethod = typeof authMethods[number];
type User = { id: string; email: string; name: string };
type StoredUser = User & { password_salt: string; password_hash: string };
type BrowserSession = User & { hash: string };
type Client = {
  id: string;
  name: string;
  redirect_uris: string;
  auth_method: AuthMethod;
  secret_hash: string | null;
  grants: string;
  scope: string;
};
type AuthorizationRequest = {
  client_id: string;
  redirect_uri: string;
  state: string | null;
  challenge: string;
  scope: string;
  resource: string;
};
type Pending = AuthorizationRequest & {
  hash: string;
  browser_hash: string;
  session_hash: string | null;
  client_name: string;
};
type Code = AuthorizationRequest & {
  user_id: string;
  grant_id: string | null;
  expires_at: number;
};
type Refresh = {
  grant_id: string;
  scope: string;
  used_at: number | null;
  expires_at: number;
  revoked_at: number | null;
  grant_expires_at: number;
};
type Credentials = z.infer<typeof loginSchema>;

const emailSchema = z.string().trim().toLowerCase().email().max(254);
const passwordSchema = z.string().min(8).max(128);
const loginSchema = z.object({ email: emailSchema, password: passwordSchema });
const registrationSchema = loginSchema.extend({ name: z.string().trim().min(1).max(100) });
const decisionSchema = z.object({
  request: z.string().regex(opaque),
  decision: z.enum(["login", "register", "allow", "deny"]),
});
const clientSchema = z.object({
  client_name: z.string().trim().min(1).max(120).default("MCP client"),
  redirect_uris: z.array(z.string().max(2_048)).min(1).max(10),
  token_endpoint_auth_method: z.enum(authMethods).default("client_secret_basic"),
  response_types: z.tuple([z.literal("code")]).default(["code"]),
  grant_types: z.array(z.enum(grantTypes)).min(1).max(2).default(["authorization_code", "refresh_token"]),
  scope: z.string().max(200).optional(),
});

const secret = () => randomBytes(32).toString("base64url");
const digest = (value: string) => createHash("sha256").update(value).digest("base64url");
const matches = (left: string, right: string) =>
  left.length === right.length && timingSafeEqual(Buffer.from(left), Buffer.from(right));
const userFields = ({ id, email, name }: User): User => ({ id, email, name });
const field = (object: Record<string, unknown> | undefined, key: string) =>
  typeof object?.[key] === "string" ? object[key] as string : undefined;

function cookie(req: Request, name: string) {
  const value = req.headers.cookie?.split(";").map(part => part.trim())
    .find(part => part.startsWith(name + "="))?.slice(name.length + 1);
  return value && opaque.test(value) ? value : undefined;
}

function parseScopes(value: unknown, fallback: Scope[]): Scope[] | undefined {
  if (value === undefined) return fallback;
  if (typeof value !== "string" || value.length > 200) return;
  const requested = value.trim().split(/ +/);
  if (requested.some(scope => !scopes.includes(scope as Scope))) return;
  return scopes.filter(scope => requested.includes(scope));
}

function redirectDetails(value: string) {
  if (!/^https?:\/\/[^/?#\\]+/i.test(value) || /[\s\u0000-\u001f\\#]/u.test(value)) return;
  try {
    const url = new URL(value);
    const loopback = /^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?(?=\/|\?|$)/i.test(value);
    if (url.username || url.password || (url.protocol !== "https:" && !loopback)) return;
    if (["code", "error", "error_description", "error_uri", "state", "iss"].some(key => url.searchParams.has(key))) return;
    return { url, loopback };
  } catch {
    return;
  }
}

function registeredRedirect(requested: string | undefined, registered: string[]) {
  if (!requested || requested.length > 2_048) return false;
  const target = redirectDetails(requested);
  if (!target) return false;
  if (registered.includes(requested)) return true;
  if (!target.loopback) return false;

  const withoutPort = (value: string) => value.replace(
    /^(http:\/\/(?:localhost|127\.0\.0\.1|\[::1\])):\d+(?=\/|\?|$)/i,
    "$1",
  );
  return registered.some(value => redirectDetails(value)?.loopback && withoutPort(value) === withoutPort(requested));
}

function verifiedResource(value: string | undefined, resource: string) {
  if (!value || !/^https?:\/\/[^/?#\\]+\/mcp$/i.test(value) || /[\s\\]/.test(value)) return false;
  try {
    const url = new URL(value);
    return !url.username && !url.password && url.href === resource;
  } catch {
    return false;
  }
}

async function passwordKey(password: string, salt: string) {
  return new Promise<string>((resolve, reject) => {
    scrypt(password, salt, 64, { N: 32_768, r: 8, p: 3, maxmem: 64 * 1024 ** 2 }, (error, key) => {
      if (error) reject(error);
      else resolve(key.toString("base64url"));
    });
  });
}

function reject(res: Response, status: number, code: string, message: string) {
  res.status(status).json({ error: { code, message } });
}

function oauthError(res: Response, error: string, description: string, status = 400) {
  res.status(status).json({ error, error_description: description });
}

function noStore(res: Response) {
  res.set({ "Cache-Control": "no-store", Pragma: "no-cache" });
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, character => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]!);
}

function authorizePage(
  res: Response,
  details?: { request: string; clientName: string; redirectUri: string; scopes: string; user?: User },
  message?: string,
  status = 200,
  screen: "login" | "register" = "login",
) {
  const callback = details && new URL(details.redirectUri);
  const heading = details?.user ? "Connect your agent" : details ? "Sign in to Forme" : "Connection unavailable";
  const error = message ? `<p class="error" role="alert">${escapeHtml(message)}</p>` : "";
  const hidden = details ? `<input type="hidden" name="request" value="${escapeHtml(details.request)}">` : "";
  let content = error;

  if (details?.user && callback) {
    const permissions = details.scopes.split(" ");
    content = `<p class="intro"><strong>${escapeHtml(details.clientName)}</strong> would like access to your Forme account.</p>
      <div class="account"><span>Signed in as</span><strong>${escapeHtml(details.user.email)}</strong></div>${error}
      <ul class="permissions">
        ${permissions.includes(readScope) ? "<li><strong>View your shopping activity</strong><span>Read your account details, cart, wishlist, orders and support requests.</span></li>" : ""}
        ${permissions.includes(writeScope) ? "<li><strong>Shop on your behalf</strong><span>Manage your cart and wishlist, place orders using your Forme balance, request changes or returns, leave reviews and contact support.</span></li>" : ""}
      </ul>
      <p class="destination">After you make a choice, you'll return to <strong>${escapeHtml(callback.host)}</strong>.</p>
      <form method="post" action="/oauth/authorize" class="actions">${hidden}
        <button class="secondary" name="decision" value="deny">Cancel</button>
        <button class="primary" name="decision" value="allow">Allow access</button>
      </form>
      <p class="footnote">You can remove this connection anytime in your Forme account.</p>`;
  } else if (details && callback) {
    const login = `<form method="post" action="/oauth/authorize" class="credentials">${hidden}
      <input type="hidden" name="decision" value="login">
      <label>Email<input type="email" name="email" required maxlength="254" autocomplete="username"></label>
      <label>Password<input type="password" name="password" required minlength="8" maxlength="128" autocomplete="current-password"></label>
      <button class="primary">Sign in</button>
    </form>`;
    const register = `<form method="post" action="/oauth/authorize" class="credentials">${hidden}
      <input type="hidden" name="decision" value="register">
      <label>Name<input name="name" required maxlength="100" autocomplete="name"></label>
      <label>Email<input type="email" name="email" required maxlength="254" autocomplete="username"></label>
      <label>Password<input type="password" name="password" required minlength="8" maxlength="128" autocomplete="new-password" aria-describedby="password-hint"><small id="password-hint">Use at least 8 characters.</small></label>
      <button class="primary">Create account</button>
    </form>`;
    content = `<p class="intro">Continue to connect <strong>${escapeHtml(details.clientName)}</strong> to your Forme account.</p>${error}
      ${screen === "register" ? register : login}
      <details><summary>${screen === "register" ? "Sign in to an existing account" : "Create a Forme account"}</summary>
        ${screen === "register" ? login : register}
      </details>
      <p class="destination">Cancel to return to <strong>${escapeHtml(callback.host)}</strong>.</p>
      <form method="post" action="/oauth/authorize" class="cancel">${hidden}
        <button name="decision" value="deny">Cancel connection</button>
      </form>`;
  }

  noStore(res);
  res.set({
    "Content-Security-Policy": `default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'${callback ? " " + callback.origin : ""}`,
    "Referrer-Policy": "same-origin",
    "X-Frame-Options": "DENY",
    "X-Content-Type-Options": "nosniff",
  });
  res.status(status).send(`<!doctype html><html lang="en"><head><meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${heading} | Forme</title>
  <style>
  :root{color-scheme:light;--ink:#25231d;--muted:#625f51;--cream:#f4f0e7;--paper:#fdfbf6;--line:#ded7ca;--accent:#9a552b}
  *{box-sizing:border-box} body{margin:0;padding:32px 20px 56px;min-height:100vh;min-height:100svh;display:grid;place-items:center;background:var(--cream);color:var(--ink);font:15px/1.5 system-ui,sans-serif}
  main{width:min(100%,510px);border:1px solid var(--line);background:var(--paper);padding:clamp(26px,7vw,48px);box-shadow:0 18px 65px #3426190e}
  header{border-bottom:1px solid var(--line);padding-bottom:22px;margin-bottom:28px}.brand{font:700 27px/1 Georgia,serif;letter-spacing:.2em;margin:0}
  h1{font:400 clamp(32px,7vw,47px)/1.05 Georgia,serif;letter-spacing:-.036em;margin:0 0 14px}
  strong{font-weight:650;overflow-wrap:anywhere}.intro,.destination,.footnote,.permissions span{color:var(--muted)}.intro{margin:0 0 23px}
  .error{padding:13px;border-left:3px solid #8d381d;background:#faece2;color:#762d1d}.account{display:grid;gap:2px;padding:12px 14px;border:1px solid var(--line)}
  .account span,small{font-size:12px;color:var(--muted)}.permissions{padding:0;margin:18px 0;list-style:none}.permissions li{padding:12px 0 12px 19px;position:relative;border-bottom:1px solid var(--line)}
  .permissions li::before{content:"";width:6px;height:6px;position:absolute;top:21px;left:2px;border-radius:50%;background:var(--accent)}.permissions span{display:block;margin-top:2px}
  .destination,.footnote{font-size:13px}.footnote{margin:16px 0 0;text-align:center}.credentials{display:grid;gap:14px}.credentials label{display:grid;gap:5px;font-weight:550}
  input{display:block;width:100%;min-height:44px;border:1px solid #a8a190;background:#fffdfa;padding:8px 10px;font:inherit;color:inherit;border-radius:0}
  button{font:650 14px/1.2 system-ui,sans-serif;min-height:45px;padding:12px 18px;border:1px solid var(--ink);cursor:pointer;border-radius:0}
  .primary{background:var(--ink);color:var(--paper)}.primary:hover{background:#473c2a}.secondary{background:transparent;color:var(--ink)}.secondary:hover{background:var(--cream)}
  .actions{display:grid;grid-template-columns:1fr 1.45fr;gap:9px;margin-top:21px}.cancel button{padding:0;background:transparent;border:0;text-decoration:underline;text-underline-offset:3px;color:var(--muted)}
  details{margin-top:18px;border-top:1px solid var(--line);padding-top:14px}summary{cursor:pointer;font-weight:600}details form{margin-top:13px}
  :focus-visible{outline:2px solid var(--accent);outline-offset:3px}
  </style></head><body><main><header><p class="brand">FORME</p></header><h1>${heading}</h1>${content}</main></body></html>`);
}

export function createAuth(commerce: Commerce, {
  baseUrl, allowedOrigins = [], trustedClientIpHeader,
}: { baseUrl: string; allowedOrigins?: string[]; trustedClientIpHeader?: string }) {
  const { db } = commerce;
  const origin = new URL(baseUrl).origin;
  const issuer = origin;
  const resource = issuer + "/mcp";
  const secure = origin.startsWith("https:");
  const configuredOrigins = new Set([origin, ...allowedOrigins.map(value => {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol) || url.origin !== value.replace(/\/$/, "")) {
      throw new Error("MCP_ALLOWED_ORIGINS must contain HTTP(S) origins.");
    }
    return url.origin;
  })]);
  const cookieOptions = { httpOnly: true, sameSite: "lax", secure, path: "/" } as const;
  const router = express.Router();

  db.exec(`
    CREATE TABLE IF NOT EXISTS auth_users (
      id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
      password_salt TEXT NOT NULL, password_hash TEXT NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS auth_sessions (
      hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
      expires_at INTEGER NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS oauth_clients (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, redirect_uris TEXT NOT NULL,
      auth_method TEXT NOT NULL, secret_hash TEXT, grants TEXT NOT NULL, scope TEXT NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS oauth_client_origins (
      origin TEXT PRIMARY KEY
    ) STRICT;
    CREATE TABLE IF NOT EXISTS oauth_pending (
      hash TEXT PRIMARY KEY, browser_hash TEXT NOT NULL,
      session_hash TEXT, client_id TEXT NOT NULL REFERENCES oauth_clients(id),
      redirect_uri TEXT NOT NULL, state TEXT, challenge TEXT NOT NULL,
      scope TEXT NOT NULL, resource TEXT NOT NULL, expires_at INTEGER NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS oauth_grants (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
      client_id TEXT NOT NULL REFERENCES oauth_clients(id), scope TEXT NOT NULL, resource TEXT NOT NULL,
      created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, revoked_at INTEGER
    ) STRICT;
    CREATE INDEX IF NOT EXISTS oauth_grants_by_user ON oauth_grants(user_id, created_at DESC);
    CREATE TABLE IF NOT EXISTS oauth_codes (
      hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
      client_id TEXT NOT NULL REFERENCES oauth_clients(id), redirect_uri TEXT NOT NULL,
      challenge TEXT NOT NULL, scope TEXT NOT NULL, resource TEXT NOT NULL,
      expires_at INTEGER NOT NULL, grant_id TEXT
    ) STRICT;
    CREATE TABLE IF NOT EXISTS oauth_tokens (
      hash TEXT PRIMARY KEY, type TEXT NOT NULL CHECK (type IN ('access', 'refresh')),
      grant_id TEXT NOT NULL REFERENCES oauth_grants(id) ON DELETE CASCADE,
      scope TEXT NOT NULL, expires_at INTEGER NOT NULL, used_at INTEGER
    ) STRICT;
    CREATE INDEX IF NOT EXISTS oauth_tokens_by_grant ON oauth_tokens(grant_id);
  `);

  const fallbackSalt = secret();
  const fallbackHash = digest(secret()) + digest(secret());
  let nextCleanup = 0;
  const passwordAttempts = new Map<string, { count: number; expires: number }>();

  function cleanup() {
    const now = Date.now();
    if (now < nextCleanup) return;
    nextCleanup = now + 15 * minute;
    db.prepare("DELETE FROM auth_sessions WHERE expires_at <= ?").run(now);
    db.prepare("DELETE FROM oauth_pending WHERE expires_at <= ?").run(now);
    db.prepare("DELETE FROM oauth_codes WHERE expires_at <= ?").run(now);
    db.prepare("DELETE FROM oauth_tokens WHERE type = 'access' AND expires_at <= ?").run(now);
    db.prepare("DELETE FROM oauth_grants WHERE expires_at <= ? OR revoked_at <= ?").run(now, now - day);
  }

  function sameOrigin(req: Request) {
    return req.get("origin") === origin;
  }

  function acceptsOrigin(value: string) {
    return configuredOrigins.has(value);
  }

  function allowPublicOrigin(_req: Request, res: Response, next: express.NextFunction) {
    res.set("Access-Control-Allow-Origin", "*");
    next();
  }

  function allowClientOrigin(req: Request, res: Response, next: express.NextFunction) {
    res.vary("Origin");
    const supplied = req.get("origin");
    if (supplied) {
      if (!acceptsOrigin(supplied) && !db.prepare("SELECT origin FROM oauth_client_origins WHERE origin = ?").get(supplied)) {
        return oauthError(res, "invalid_request", "This browser origin is not authorized.", 403);
      }
      res.set("Access-Control-Allow-Origin", supplied);
    }
    next();
  }

  function authorizePreflight(_req: Request, res: Response) {
    res.set({
      "Access-Control-Allow-Headers": "Authorization, Content-Type",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Max-Age": "600",
    }).status(204).end();
  }

  function throttlePassword(req: Request, res: Response) {
    const now = Date.now();
    const forwarded = trustedClientIpHeader && req.get(trustedClientIpHeader);
    const key = forwarded && isIP(forwarded) ? forwarded : req.ip ?? req.socket.remoteAddress ?? "";
    if (passwordAttempts.size >= 2_048) {
      for (const [ip, attempt] of passwordAttempts) if (attempt.expires <= now) passwordAttempts.delete(ip);
      if (passwordAttempts.size >= 2_048 && !passwordAttempts.has(key)) passwordAttempts.delete(passwordAttempts.keys().next().value!);
    }
    let attempt = passwordAttempts.get(key);
    if (!attempt || attempt.expires <= now) {
      attempt = { count: 0, expires: now + 10 * minute };
      passwordAttempts.set(key, attempt);
    }
    if (++attempt.count <= 20) return false;
    res.set("Retry-After", String(Math.ceil((attempt.expires - now) / 1000)));
    return true;
  }

  function browserSession(req: Request): BrowserSession | undefined {
    const current = cookie(req, sessionCookie);
    if (!current) return;
    return db.prepare(`
      SELECT u.id, u.email, c.name, s.hash FROM auth_sessions s
      JOIN auth_users u ON u.id = s.user_id JOIN customers c ON c.id = u.id
      WHERE s.hash = ? AND s.expires_at > ?
    `).get(digest(current), Date.now()) as BrowserSession | undefined;
  }

  function sessionUser(req: Request) {
    const current = browserSession(req);
    return current && userFields(current);
  }

  function authenticateBearer(req: Request) {
    const raw = req.get("authorization")?.match(/^Bearer ([A-Za-z0-9_-]{43})$/i)?.[1];
    if (!raw) return;
    const now = Date.now();
    const row = db.prepare(`
      SELECT u.id, u.email, c.name, t.scope FROM oauth_tokens t
      JOIN oauth_grants g ON g.id = t.grant_id JOIN auth_users u ON u.id = g.user_id
      JOIN customers c ON c.id = u.id
      WHERE t.hash = ? AND t.type = 'access' AND t.expires_at > ?
        AND g.expires_at > ? AND g.revoked_at IS NULL AND g.resource = ?
    `).get(digest(raw), now, now, resource) as (User & { scope: string }) | undefined;
    return row && { ...userFields(row), scopes: row.scope.split(" ") };
  }

  async function authenticatePassword({ email, password }: Credentials) {
    const stored = db.prepare(`
      SELECT u.id, u.email, c.name, u.password_salt, u.password_hash
      FROM auth_users u JOIN customers c ON c.id = u.id WHERE u.email = ?
    `).get(email) as StoredUser | undefined;
    const computed = await passwordKey(password, stored?.password_salt ?? fallbackSalt);
    return matches(computed, stored?.password_hash ?? fallbackHash) && stored ? userFields(stored) : undefined;
  }

  async function createUser({ email, password, name }: z.infer<typeof registrationSchema>) {
    const salt = secret();
    const hash = await passwordKey(password, salt);
    const user = { id: randomUUID(), email, name };
    return db.transaction(() => {
      const result = db.prepare(`
        INSERT INTO auth_users (id, email, name, password_salt, password_hash)
        VALUES (?, ?, ?, ?, ?) ON CONFLICT(email) DO NOTHING
      `).run(user.id, email, name, salt, hash);
      if (!result.changes) return;
      commerce.ensureCustomer(user.id, email, name);
      return user;
    });
  }

  function startSession(req: Request, user: User) {
    const old = cookie(req, sessionCookie);
    if (old) db.prepare("DELETE FROM auth_sessions WHERE hash = ?").run(digest(old));
    const value = secret();
    db.prepare("INSERT INTO auth_sessions VALUES (?, ?, ?)").run(digest(value), user.id, Date.now() + sessionLifetime);
    return value;
  }

  function setSession(res: Response, value: string) {
    res.cookie(sessionCookie, value, { ...cookieOptions, maxAge: sessionLifetime });
  }

  function getClient(id: string | undefined) {
    return id && id.length <= 100
      ? db.prepare("SELECT * FROM oauth_clients WHERE id = ?").get(id) as Client | undefined
      : undefined;
  }

  function authenticatedClient(req: Request) {
    const userInfo = req.get("authorization");
    let id = field(req.body, "client_id");
    let credential = field(req.body, "client_secret");
    if ((req.body?.client_id !== undefined && !id) || (req.body?.client_secret !== undefined && !credential)) return;
    let method: AuthMethod = credential === undefined ? "none" : "client_secret_post";
    if (userInfo) {
      if (credential !== undefined) return;
      const base64 = userInfo.match(/^Basic ([A-Za-z0-9+/]+={0,2})$/i)?.[1];
      if (!base64 || base64.length > 1_024) return;
      try {
        const decoded = Buffer.from(base64, "base64").toString("utf8");
        const colon = decoded.indexOf(":");
        if (colon < 0) return;
        const formDecode = (value: string) => decodeURIComponent(value.replaceAll("+", " "));
        const basicId = formDecode(decoded.slice(0, colon));
        if (id && id !== basicId) return;
        id = basicId;
        credential = formDecode(decoded.slice(colon + 1));
        method = "client_secret_basic";
      } catch {
        return;
      }
    }
    const client = getClient(id);
    if (!client || client.auth_method !== method) return;
    if (method !== "none" && (!credential || !client.secret_hash || !matches(digest(credential), client.secret_hash))) return;
    return client;
  }

  function redirectToClient(res: Response, redirectUri: string, state: string | null, result: Record<string, string>) {
    const target = new URL(redirectUri);
    for (const [key, value] of Object.entries(result)) target.searchParams.set(key, value);
    if (state !== null) target.searchParams.set("state", state);
    target.searchParams.set("iss", issuer);
    noStore(res);
    res.set("Referrer-Policy", "no-referrer").redirect(303, target.href);
  }

  function pendingAuthorization(req: Request, request: string) {
    const binding = cookie(req, consentCookie);
    if (!binding) return;
    return db.prepare(`
      SELECT p.*, c.name AS client_name FROM oauth_pending p
      JOIN oauth_clients c ON c.id = p.client_id
      WHERE p.hash = ? AND p.browser_hash = ? AND p.expires_at > ?
    `).get(digest(request), digest(binding), Date.now()) as Pending | undefined;
  }

  function displayPending(
    res: Response, pending: Pending, request: string, user?: User, message?: string,
    status?: number, screen?: "login" | "register",
  ) {
    authorizePage(res, {
      request, clientName: pending.client_name, redirectUri: pending.redirect_uri,
      scopes: pending.scope, user,
    }, message, status, screen);
  }

  function revokeGrant(id: string, now: number) {
    db.prepare("UPDATE oauth_grants SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL").run(now, id);
  }

  function issueTokens(
    grantId: string, scope: string, now: number, expiresAt: number, refreshable: boolean,
  ) {
    const insert = db.prepare("INSERT INTO oauth_tokens (hash, type, grant_id, scope, expires_at) VALUES (?, ?, ?, ?, ?)");
    const accessToken = secret();
    const accessExpires = Math.min(now + accessLifetime, expiresAt);
    insert.run(digest(accessToken), "access", grantId, scope, accessExpires);
    const refreshToken = refreshable ? secret() : undefined;
    if (refreshToken) insert.run(digest(refreshToken), "refresh", grantId, scope, expiresAt);
    return {
      access_token: accessToken, token_type: "Bearer", expires_in: Math.floor((accessExpires - now) / 1000),
      ...(refreshToken ? { refresh_token: refreshToken } : {}), scope,
    };
  }

  router.get("/api/session", (req, res) => {
    noStore(res);
    res.json({ user: sessionUser(req) ?? null });
  });

  router.post("/api/auth/register", jsonBody, async (req, res) => {
    noStore(res);
    if (!sameOrigin(req)) return reject(res, 403, "forbidden_origin", "This request must come from the Forme website.");
    const input = registrationSchema.safeParse(req.body);
    if (!input.success) return reject(res, 400, "invalid_input", "Enter a name, valid email and a password from 8 to 128 characters.");
    if (throttlePassword(req, res)) return reject(res, 429, "too_many_attempts", "Try again in a few minutes.");
    cleanup();
    const user = await createUser(input.data);
    if (!user) return reject(res, 409, "email_in_use", "An account already uses this email.");
    setSession(res, db.transaction(() => startSession(req, user)));
    res.status(201).json({ user });
  });

  router.post("/api/auth/login", jsonBody, async (req, res) => {
    noStore(res);
    if (!sameOrigin(req)) return reject(res, 403, "forbidden_origin", "This request must come from the Forme website.");
    const input = loginSchema.safeParse(req.body);
    if (!input.success) return reject(res, 400, "invalid_input", "Enter your email and password.");
    if (throttlePassword(req, res)) return reject(res, 429, "too_many_attempts", "Try again in a few minutes.");
    cleanup();
    const user = await authenticatePassword(input.data);
    if (!user) return reject(res, 401, "invalid_credentials", "The email or password is incorrect.");
    setSession(res, db.transaction(() => startSession(req, user)));
    res.json({ user });
  });

  router.post("/api/auth/logout", (req, res) => {
    noStore(res);
    if (!sameOrigin(req)) return reject(res, 403, "forbidden_origin", "This request must come from the Forme website.");
    const current = cookie(req, sessionCookie);
    if (current) db.prepare("DELETE FROM auth_sessions WHERE hash = ?").run(digest(current));
    res.clearCookie(sessionCookie, cookieOptions).json({ user: null });
  });

  router.get("/api/auth/connections", (req, res) => {
    noStore(res);
    const user = sessionUser(req);
    if (!user) return reject(res, 401, "authentication_required", "Sign in to see your connected agents.");
    const connections = db.prepare(`
      SELECT g.id, c.name AS clientName, g.scope, g.created_at FROM oauth_grants g
      JOIN oauth_clients c ON c.id = g.client_id
      WHERE g.user_id = ? AND g.resource = ? AND g.revoked_at IS NULL AND g.expires_at > ?
      ORDER BY g.created_at DESC, g.id
    `).all(user.id, resource, Date.now()) as Array<{ id: string; clientName: string; scope: string; created_at: number }>;
    res.json({ connections: connections.map(({ id, clientName, scope, created_at }) => ({
      id, clientName, scopes: scope.split(" "), createdAt: new Date(created_at).toISOString(),
    })) });
  });

  router.delete("/api/auth/connections/:id", (req, res) => {
    noStore(res);
    if (!sameOrigin(req)) return reject(res, 403, "forbidden_origin", "This request must come from the Forme website.");
    const user = sessionUser(req);
    if (!user) return reject(res, 401, "authentication_required", "Sign in to manage your connected agents.");
    const now = Date.now();
    const result = db.prepare(`
      UPDATE oauth_grants SET revoked_at = ?
      WHERE id = ? AND user_id = ? AND resource = ? AND revoked_at IS NULL AND expires_at > ?
    `).run(now, req.params.id, user.id, resource, now);
    if (!result.changes) return reject(res, 404, "connection_not_found", "This connection is no longer available.");
    res.status(204).end();
  });

  router.get(["/.well-known/oauth-protected-resource/mcp", "/.well-known/oauth-protected-resource"], allowPublicOrigin, (_req, res) => {
    res.json({
      resource, resource_name: "Forme", authorization_servers: [issuer],
      scopes_supported: scopes, bearer_methods_supported: ["header"],
    });
  });

  router.get("/.well-known/oauth-authorization-server", allowPublicOrigin, (_req, res) => {
    res.json({
      issuer, authorization_endpoint: issuer + "/oauth/authorize",
      token_endpoint: issuer + "/oauth/token", registration_endpoint: issuer + "/oauth/register",
      revocation_endpoint: issuer + "/oauth/revoke", scopes_supported: scopes,
      response_types_supported: ["code"], response_modes_supported: ["query"],
      grant_types_supported: grantTypes, code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: authMethods, revocation_endpoint_auth_methods_supported: authMethods,
      authorization_response_iss_parameter_supported: true,
    });
  });

  router.options("/oauth/register", allowPublicOrigin, authorizePreflight);
  router.options(["/oauth/token", "/oauth/revoke"], allowClientOrigin, authorizePreflight);
  router.post("/oauth/register", allowPublicOrigin, jsonBody, (req, res) => {
    noStore(res);
    const input = clientSchema.safeParse(req.body);
    if (!input.success) return oauthError(res, "invalid_client_metadata", "Register a client for the authorization code grant.");
    const data = input.data;
    if (!data.redirect_uris.every(redirectDetails)) {
      return oauthError(res, "invalid_redirect_uri", "Callbacks must use HTTPS or an HTTP loopback address.");
    }
    const clientGrants = [...new Set(data.grant_types)];
    if (!clientGrants.includes("authorization_code")) {
      return oauthError(res, "invalid_client_metadata", "The authorization code grant is required.");
    }
    const allowed = parseScopes(data.scope, [...scopes]);
    if (!allowed) return oauthError(res, "invalid_scope", "Request supported Forme scopes.");
    const id = randomUUID();
    const clientSecret = data.token_endpoint_auth_method === "none" ? undefined : secret();
    const scope = allowed.join(" ");
    const redirects = [...new Set(data.redirect_uris)];
    db.transaction(() => {
      db.prepare("INSERT INTO oauth_clients VALUES (?, ?, ?, ?, ?, ?, ?)").run(
        id, data.client_name, JSON.stringify(redirects), data.token_endpoint_auth_method,
        clientSecret ? digest(clientSecret) : null, JSON.stringify(clientGrants), scope,
      );
      const insertOrigin = db.prepare("INSERT INTO oauth_client_origins VALUES (?) ON CONFLICT DO NOTHING");
      for (const redirect of redirects) insertOrigin.run(new URL(redirect).origin);
    });
    res.status(201).json({
      ...data, redirect_uris: redirects, grant_types: clientGrants, scope, client_id: id,
      client_id_issued_at: Math.floor(Date.now() / 1000),
      ...(clientSecret ? { client_secret: clientSecret, client_secret_expires_at: 0 } : {}),
    });
  });

  router.get("/oauth/authorize", (req, res) => {
    cleanup();
    const client = getClient(field(req.query, "client_id"));
    const redirectUri = field(req.query, "redirect_uri");
    if (!client || !redirectUri || !registeredRedirect(redirectUri, JSON.parse(client.redirect_uris))) {
      return authorizePage(res, undefined, "The agent's connection details could not be verified.", 400);
    }
    const state = field(req.query, "state") ?? null;
    if ((req.query.state !== undefined && state === null) || (state && state.length > 1_024)) {
      return authorizePage(res, undefined, "The connection request is invalid.", 400);
    }
    // Public registration alone does not make an origin trustworthy for automatic redirects.
    const fail = (error: string, error_description: string) => acceptsOrigin(new URL(redirectUri).origin)
      ? redirectToClient(res, redirectUri, state, { error, error_description })
      : authorizePage(res, undefined, error_description, 400);
    if (field(req.query, "response_type") !== "code") return fail("unsupported_response_type", "Use the authorization code flow.");
    if (req.query.response_mode !== undefined && field(req.query, "response_mode") !== "query") {
      return fail("invalid_request", "Use the query response mode.");
    }
    const challenge = field(req.query, "code_challenge");
    if (field(req.query, "code_challenge_method") !== "S256" || !challenge || !opaque.test(challenge)) {
      return fail("invalid_request", "An S256 PKCE challenge is required.");
    }
    if (!verifiedResource(field(req.query, "resource"), resource)) {
      return fail("invalid_target", "The request must target the Forme MCP endpoint.");
    }
    const clientScopes = client.scope.split(" ") as Scope[];
    const defaultScopes: Scope[] = clientScopes.includes(readScope) ? [readScope] : clientScopes;
    const allowed = parseScopes(req.query.scope, defaultScopes);
    if (!allowed?.length || allowed.some(scope => !clientScopes.includes(scope))) {
      return fail("invalid_scope", "Request supported scopes registered by this client.");
    }
    const browser = cookie(req, consentCookie) ?? secret();
    const request = secret();
    const current = browserSession(req);
    const pending: Pending = {
      hash: digest(request), browser_hash: digest(browser), session_hash: current?.hash ?? null,
      client_id: client.id, client_name: client.name, redirect_uri: redirectUri, state, challenge,
      scope: allowed.join(" "), resource,
    };
    db.prepare(`
      INSERT INTO oauth_pending (hash, browser_hash, session_hash, client_id, redirect_uri, state, challenge, scope, resource, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(pending.hash, pending.browser_hash, pending.session_hash, client.id, redirectUri, state,
      challenge, pending.scope, resource, Date.now() + consentLifetime);
    res.cookie(consentCookie, browser, { ...cookieOptions, maxAge: consentLifetime });
    displayPending(res, pending, request, current);
  });

  router.post("/oauth/authorize", tokenUrlencoded, async (req, res) => {
    if (!sameOrigin(req)) return authorizePage(res, undefined, "Return to your agent and start the connection again.", 403);
    const input = decisionSchema.safeParse(req.body);
    const expired = () => authorizePage(res, undefined, "This request expired or your account changed. Start the connection again from your agent.", 400);
    if (!input.success) return expired();
    const { decision, request } = input.data;
    const pending = pendingAuthorization(req, request);
    const current = browserSession(req);
    if (!pending || pending.session_hash !== (current?.hash ?? null)) return expired();
    if (decision === "deny") {
      const deleted = db.prepare("DELETE FROM oauth_pending WHERE hash = ?").run(pending.hash);
      if (!deleted.changes) return expired();
      return redirectToClient(res, pending.redirect_uri, pending.state, { error: "access_denied" });
    }

    if (decision === "login" || decision === "register") {
      if (current) return expired();
      if (throttlePassword(req, res)) return displayPending(res, pending, request, undefined, "Try again in a few minutes.", 429, decision);
      const signup = decision === "register" ? registrationSchema.safeParse(req.body) : undefined;
      const login = decision === "login" ? loginSchema.safeParse(req.body) : undefined;
      const user = signup?.success ? await createUser(signup.data)
        : login?.success ? await authenticatePassword(login.data) : undefined;
      if (!user) {
        const message = decision === "register"
          ? signup?.success ? "An account already uses this email." : "Enter a name, valid email and a password from 8 to 128 characters."
          : "The email or password is incorrect.";
        return displayPending(res, pending, request, undefined, message, 400, decision);
      }
      const session = db.transaction(() => {
        const requestStillPending = db.prepare(`
          SELECT hash FROM oauth_pending WHERE hash = ? AND session_hash IS NULL AND expires_at > ?
        `).get(pending.hash, Date.now());
        if (!requestStillPending) return;
        const value = startSession(req, user);
        db.prepare("UPDATE oauth_pending SET session_hash = ? WHERE hash = ?").run(digest(value), pending.hash);
        return value;
      });
      if (!session) return expired();
      setSession(res, session);
      return displayPending(res, pending, request, user);
    }

    if (!current) {
      return displayPending(res, pending, request, undefined, "Sign in before approving this connection.", 401);
    }
    const code = db.transaction(() => {
      const now = Date.now();
      const deleted = db.prepare(`
        DELETE FROM oauth_pending WHERE hash = ? AND session_hash = ? AND expires_at > ?
        AND EXISTS (SELECT 1 FROM auth_sessions WHERE hash = ? AND expires_at > ?)
      `).run(pending.hash, current.hash, now, current.hash, now);
      if (!deleted.changes) return;
      const value = secret();
      db.prepare(`
        INSERT INTO oauth_codes (hash, user_id, client_id, redirect_uri, challenge, scope, resource, expires_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(digest(value), current.id, pending.client_id, pending.redirect_uri, pending.challenge,
        pending.scope, pending.resource, Date.now() + codeLifetime);
      return value;
    });
    if (!code) return expired();
    redirectToClient(res, pending.redirect_uri, pending.state, { code });
  });

  router.post("/oauth/token", allowClientOrigin, tokenUrlencoded, (req, res) => {
    noStore(res);
    cleanup();
    const client = authenticatedClient(req);
    if (!client) {
      if (req.get("authorization")) res.set("WWW-Authenticate", 'Basic realm="Forme"');
      return oauthError(res, "invalid_client", "Client authentication failed.", 401);
    }
    const grantType = field(req.body, "grant_type");
    if (!grantTypes.includes(grantType as typeof grantTypes[number])) {
      return oauthError(res, "unsupported_grant_type", "Use an authorization code or refresh token.");
    }
    const allowed = JSON.parse(client.grants) as string[];
    if (!allowed.includes(grantType!)) return oauthError(res, "unauthorized_client", "This grant type was not registered.");
    if (!verifiedResource(field(req.body, "resource"), resource)) {
      return oauthError(res, "invalid_target", "The request must target the Forme MCP endpoint.");
    }
    const now = Date.now();

    if (grantType === "authorization_code") {
      const code = field(req.body, "code");
      const verifier = field(req.body, "code_verifier");
      const redirect = field(req.body, "redirect_uri");
      if (!code || !opaque.test(code) || !verifier || !verifierPattern.test(verifier) || !redirect) {
        return oauthError(res, "invalid_grant", "The authorization code, redirect URI or PKCE verifier is invalid.");
      }
      const result = db.transaction(() => {
        const hash = digest(code);
        const row = db.prepare("SELECT * FROM oauth_codes WHERE hash = ?").get(hash) as Code | undefined;
        if (!row || row.expires_at <= now || row.client_id !== client.id || row.redirect_uri !== redirect
          || row.resource !== resource || !matches(row.challenge, digest(verifier))) return;
        if (row.grant_id) {
          revokeGrant(row.grant_id, now);
          return;
        }
        const id = randomUUID();
        const expiresAt = now + (allowed.includes("refresh_token") ? grantLifetime : accessLifetime);
        db.prepare(`
          INSERT INTO oauth_grants (id, user_id, client_id, scope, resource, created_at, expires_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(id, row.user_id, client.id, row.scope, resource, now, expiresAt);
        db.prepare("UPDATE oauth_codes SET grant_id = ? WHERE hash = ?").run(id, hash);
        return issueTokens(id, row.scope, now, expiresAt, allowed.includes("refresh_token"));
      });
      if (!result) return oauthError(res, "invalid_grant", "The authorization code has expired or could not be verified.");
      return res.json(result);
    }

    const refreshToken = field(req.body, "refresh_token");
    if (!refreshToken || !opaque.test(refreshToken)) return oauthError(res, "invalid_grant", "The refresh token is invalid.");
    const result = db.transaction(() => {
      const hash = digest(refreshToken);
      const row = db.prepare(`
        SELECT t.grant_id, t.scope, t.used_at, t.expires_at, g.revoked_at, g.expires_at AS grant_expires_at
        FROM oauth_tokens t JOIN oauth_grants g ON g.id = t.grant_id
        WHERE t.hash = ? AND t.type = 'refresh' AND g.client_id = ? AND g.resource = ?
      `).get(hash, client.id, resource) as Refresh | undefined;
      if (!row || row.revoked_at !== null || row.expires_at <= now || row.grant_expires_at <= now) return;
      if (row.used_at !== null) {
        revokeGrant(row.grant_id, now);
        return;
      }
      const granted = row.scope.split(" ") as Scope[];
      const requested = parseScopes(req.body?.scope, granted);
      if (!requested || requested.some(scope => !granted.includes(scope))) return "invalid_scope" as const;
      db.prepare("UPDATE oauth_tokens SET used_at = ? WHERE hash = ?").run(now, hash);
      return issueTokens(row.grant_id, requested.join(" "), now, row.grant_expires_at, true);
    });
    if (result === "invalid_scope") return oauthError(res, "invalid_scope", "Refresh cannot add permissions.");
    if (!result) return oauthError(res, "invalid_grant", "The refresh token has expired or could not be verified.");
    res.json(result);
  });

  router.post("/oauth/revoke", allowClientOrigin, tokenUrlencoded, (req, res) => {
    noStore(res);
    const client = authenticatedClient(req);
    if (!client) {
      if (req.get("authorization")) res.set("WWW-Authenticate", 'Basic realm="Forme"');
      return oauthError(res, "invalid_client", "Client authentication failed.", 401);
    }
    const token = field(req.body, "token");
    if (!token) return oauthError(res, "invalid_request", "A token is required.");
    if (opaque.test(token)) {
      const now = Date.now();
      db.prepare(`
        UPDATE oauth_grants SET revoked_at = ? WHERE client_id = ? AND resource = ? AND revoked_at IS NULL
          AND id = (SELECT grant_id FROM oauth_tokens WHERE hash = ?)
      `).run(now, client.id, resource, digest(token));
    }
    res.status(200).end();
  });

  return { router, sessionUser, authenticateBearer, acceptsOrigin };
}

export type Auth = ReturnType<typeof createAuth>;

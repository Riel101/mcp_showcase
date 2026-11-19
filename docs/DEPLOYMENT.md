# Deployment

The live Cloudflare deployment uses Workers Static Assets and SQLite-backed Durable Objects. See [Cloudflare setup](CLOUDFLARE.md). The container instructions below apply to the Node hosting option.

## Local container

```sh
docker compose up --build
```

Open `http://localhost:3000`. The named `forme-data` volume preserves accounts, OAuth clients, carts, orders, and balances across container replacements.

## Public hosting

Deploy the Docker image to a host that provides a persistent writable volume and an HTTPS reverse proxy. Set:

```text
BASE_URL=https://your-store.example
HOST=0.0.0.0
PORT=3000
DATABASE_PATH=/app/data/forme.sqlite
NODE_ENV=production
```

Mount the persistent volume at `/app/data`. The reverse proxy must preserve the external Host header and forward `/mcp`, `/oauth/*`, `/.well-known/*`, and `/api/*` unchanged. Do not place a separate interactive access-login gateway in front of the OAuth metadata or MCP endpoint; that prevents standards-based clients from discovering authorization.

The browser and MCP endpoint use the same public origin. HTTPS enables secure session cookies. Register the server URL as `https://your-store.example/mcp` in each client and complete OAuth. Do not deploy with the example hostname or publish a localhost issuer.

Native/server clients do not need a CORS origin. A browser-hosted client that probes `/mcp` before registering should have its exact HTTPS origin listed in `MCP_ALLOWED_ORIGINS`; never use a wildcard for authenticated cross-origin access.

Run one application instance against its SQLite volume. For horizontal scaling, migrate the shared data layer to a transactional database designed for concurrent hosts and move rate-limiting counters to shared storage. SQLite WAL and its sidecar files must remain on the same persistent local filesystem.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `BASE_URL` | `http://localhost:3000` | Canonical OAuth issuer and storefront origin |
| `PORT` | `3000` | HTTP listener port |
| `HOST` | `127.0.0.1` | Listener address; container sets `0.0.0.0` |
| `DATABASE_PATH` | `./data/forme.sqlite` | Persistent SQLite database |
| `NODE_ENV` | unset locally | Set to `production` in deployment |
| `MCP_ALLOWED_ORIGINS` | empty | Optional comma-separated browser MCP client origins |

The application reads `.env` for local start and development. Do not include `.env`, database files, or customer data in a source archive or image.

## Operations

- Health: `GET /health` returns a small JSON status. Supply the canonical Host when probing the container directly.
- Back up the database with SQLite’s backup mechanism or during a clean shutdown; copying only the main file while WAL writes are active can omit transactions.
- Keep the canonical origin stable. Changing it invalidates the resource binding of existing OAuth grants; customers should reconnect their agents.
- Customer data and OAuth credentials are local to this deployment. Revoking a connected agent invalidates its grant.
- Rebuild frontend assets with `npm run build` before starting a source deployment.

## Boundaries to extend before a commercial launch

This package is a client showcase. Payment and fulfillment adapters are local; integrating actual providers is a separate deployment decision. The customer interface intentionally contains no simulation banners. Do not collect payment-card numbers through this implementation.

Email delivery, password recovery, stock administration, carrier integration, tax jurisdiction rules, and staff-operated support resolution are outside this showcase package. Support requests are persisted and retrievable, but no external message is sent. Audit the custom OAuth service, apply organization-specific abuse controls, and add operational monitoring before exposing a commercial service.

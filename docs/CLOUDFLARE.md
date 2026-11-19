# Deploy Forme on Cloudflare Workers

The Worker serves the built storefront through Static Assets. The HTTP API, OAuth endpoints, and MCP transport share the same Express routes as the Node server. A SQLite-backed Durable Object owns one store's inventory, orders, and auth records, so a checkout can update inventory and credit in one transaction. The local Node database and the deployed store database are independent.

Use a Workers Free account. SQLite-backed Durable Objects and Static Assets are available on that plan. When the free limits are reached, Cloudflare rejects operations subject to those limits. See [Durable Object pricing and quotas](https://developers.cloudflare.com/durable-objects/platform/pricing/) and [Workers Static Assets pricing](https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/).

## Test locally

Open a terminal from the project directory and run:

```sh
npm ci
npm run build
npm run cf:types -- --strict-vars=false
npx tsc -p tsconfig.worker.json
npm run cf:check
npm run cf:dev -- --var BASE_URL:http://localhost:8787
```

In another terminal run this smoke test against the local Wrangler instance. It creates a customer and OAuth client, verifies both shopping surfaces share an account and cart, places and cancels a store-balance order, and revokes the grant.

```sh
node tests/cloudflare-smoke.mjs http://localhost:8787
```

Wrangler stores local Durable Object data under `.wrangler/state`. Pass `--persist-to` to `wrangler dev` to choose an isolated local state directory.

## Deploy

Sign in with `npx wrangler login`. Check the account in `npx wrangler whoami` and enable its `workers.dev` subdomain if this is its first Worker. Configure `name` and `vars.BASE_URL` in `wrangler.jsonc` for the deployment you are targeting. Use the exact public HTTPS origin without a trailing slash. The authorization issuer, token audience, secure cookies, and MCP resource metadata use that origin.

```sh
npm run cf:deploy
```

The Worker URL in Wrangler's output should match `BASE_URL`. Open that URL for the store, and use the same URL with `/mcp` appended for the agent connection. For a custom domain, configure the route in Cloudflare and update `BASE_URL` together. Optional browser-based MCP clients with their own web origin require an explicit comma-separated list in `MCP_ALLOWED_ORIGINS`.

Keep the `FormeStore` Durable Object migration and store key stable on updates to preserve customer records. The bundled storefront assets are read-only in Cloudflare. Customer records live in the Durable Object, where SQLite storage supports [point-in-time recovery](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/#point-in-time-recovery-pitr).

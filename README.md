# FORME — commerce for people and their agents

A complete ecommerce storefront and a bespoke OAuth-protected MCP server, backed by the same persistent commerce service. Browse a curated home, desk, travel, and audio collection in the browser, or let an MCP client discover products, manage a basket, buy, track, cancel, return, review, and contact support.

## Run locally

Requires Node.js 24 or later.

```sh
npm ci
npm run build
npm start
```

Open **http://localhost:3000**. Create an account from the storefront or the OAuth authorization screen. New accounts receive a Forme balance; checkout uses this balance and does not collect payment-card information.

For development with live frontend updates:

```sh
npm run dev
```

Optional configuration: copy `.env.example` to `.env`. Both start commands read `.env`. `BASE_URL` must exactly match the origin used in the browser and MCP client, including the port. SQLite state lives in `data/forme.sqlite` and survives restarts.

## Connect an agent

Add a **remote Streamable HTTP MCP server** in a client that supports OAuth authorization-code flow with PKCE and dynamic client registration:

```text
http://localhost:3000/mcp
```

Choose OAuth and complete the client’s authorization flow. There is no API key to paste into the model, no shared customer identity, and no requirement to shop in the browser first. The authorization screen supports account creation, sign-in, consent, and returning to the client. Account → Connected agents lets the customer revoke access.

A desktop client can reach localhost. A cloud-hosted agent needs a deployed HTTPS URL; its own `localhost` is not your computer. See [deployment](docs/DEPLOYMENT.md).

## What is included

- Responsive storefront, product details, search/filter/sort, comparisons, wishlist, cart, discounts, shipping quotes, checkout, account/address management, orders, returns, reviews, and support cases.
- Intent-based MCP tools with compact discovery, richer inspection, scoped permissions, actionable errors, and annotations.
- Real SQLite persistence shared across browser and MCP operations.
- Atomic inventory and balance updates, immutable checkout quotes, idempotent order placement, ownership checks, cancellation, and partial-return accounting.
- OAuth discovery, dynamic registration, PKCE, scoped access tokens, rotating refresh tokens, revocation, and separate browser sessions.
- Docker packaging with a persistent volume, health endpoint, and production frontend build.

## Validation

```sh
npm test
npm run build
```

Tests exercise commerce invariants, authorization, and cross-channel MCP workflows. Read the final delivery notes for the checks completed in this environment.

## Project map

| Location | Responsibility |
| --- | --- |
| `src/server/commerce.ts` | Shared commerce rules and SQLite transactions |
| `src/server/catalog.ts` | Product collection |
| `src/server/auth.ts` | Browser accounts and OAuth authorization server |
| `src/server/mcp.ts` | MCP tool descriptions, schemas, scopes, and transport |
| `src/server/index.ts` | HTTP API, host validation, frontend hosting |
| `src/client/` | React storefront |
| `tests/` | Domain, OAuth, and integration checks |

[Cloudflare deployment](docs/CLOUDFLARE.md) · [Client presentation walkthrough](docs/SHOWCASE.md) · [MCP design](docs/MCP_DESIGN.md) · [Deployment](docs/DEPLOYMENT.md)

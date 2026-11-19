# Validation record

Validated locally on 18 November 2026 using Node 24.13.1.

## Automated checks

- Production TypeScript/Vite build.
- 17 passing automated tests covering commerce and real HTTP OAuth/MCP integration.
- Official SDK client connects over Streamable HTTP, discovers tools, changes the cart, prepares checkout, and places an order. The browser API reads that same cart and order.
- Reusing a purchase key does not create another order. Changed, expired, consumed, and foreign quotes are rejected.
- Stock contention and balance failures preserve inventory and customer balances.
- Cancellation restores full credit once; partial returns refund exact discounted merchandise amounts without duplicate refunds.
- Order and support history pagination, saved-state persistence after restart, and verified-purchase reviews.
- PKCE challenge verification, resource binding, authorization-code replay rejection, scope enforcement, refresh rotation/reuse detection, callback validation, origin rejection, and revocation.
- Production dependency audit reported no known vulnerabilities. The development-only Vite dependency tree has a reported picomatch advisory without an available patched release at validation time. Build dependencies are excluded from the final Docker runtime stage.
- All 20 catalog products reference present local image assets.

## Browser checks

Visually inspected the homepage at the default narrow viewport and at 1440 × 1000. The browser reported no console errors during the initial storefront check. Exercised account creation, resuming an add-to-cart action, FORME10 discount application, shipping-address entry, quote review, and order placement. The browser reached the new order URL and displayed the order-placed notification.

The browser connection then closed, preventing the remaining interactive order-detail, return, and mobile account checks. Those domain workflows are covered by automated tests, but the remaining UI interactions have not all been exercised in a browser.

## Packaging boundaries

The deployment archive includes source, bundled imagery, frontend build, lockfile, documentation, tests, and Docker configuration. It excludes node_modules, live SQLite data, environment secrets, and Git metadata.

Docker is not installed in this environment, so the image build and container healthcheck could not be executed here. The ordinary Node application and its production frontend were run successfully. No public deployment was requested or made.

## Development startup fix — 19 November 2026

The original dev command failed when `.env` was absent: Node 24.13.1's watch supervisor attempted to watch the missing optional file and exited with ENOENT. This disconnect can surface as EPIPE in the child module loader. The dev launcher now passes an environment-file argument only when the file exists.

Two regression checks verify startup and automatic reload with and without `.env`. The original command fails the missing-file check; the corrected launcher passes both. Vite now uses its runner configuration loader to avoid temporary config-bundle files triggering repeated Node watcher restarts. The real development server served its health endpoint, homepage, and transformed React entry with HTTP 200 and remained running afterward.

## Cloudflare deployment — 19 November 2026

Deployed to https://forme-store.adeyemigabriel429.workers.dev with version feddf35c-da1a-40be-ad8c-b68f2837c643. The Worker uses Static Assets and SQLite-backed Durable Object storage. Node and Cloudflare share their commerce, OAuth, and MCP routes; only the storage driver and hosting entrypoint differ.

All 22 automated regression tests passed. Separate Worker type checking and Wrangler production dry-run passed. The actual workerd test verified atomic rollback after a prior inventory debit, safe idempotent replay, and exact cancellation accounting. Cloudflare runtime scrypt matched the Node password digest.

The complete smoke test passed both locally in workerd and against the public deployment: storefront/deep links/images, catalog, request limits, registration/login, OAuth PKCE consent and token exchange, official MCP SDK tool discovery, shared browser/agent cart, checkout and idempotency, cancellation, secure cookies, and grant revocation. The smoke account and cancelled order remain in hosted test data; the OAuth grant is revoked. Local Node accounts were not copied to the new hosted database.

## Canonical product imagery — 19 November 2026

Discovery and wishlist summaries include absolute primary `image` URLs from the catalog. Inspection embeds actual primary WebP photos as MCP image blocks by default; `includeImages: false` supports text-only comparisons. Photos load directly through the Cloudflare Static Assets binding in the Worker, with per-photo size bounds. Node integration tests assert embedded bytes exactly match the website asset. Live connector checks verified all 20 products return image blocks and share discovery/inspection URLs. The homepage Arc Task Lamp hero now uses the same photo as its product page. MCP descriptions direct clients to avoid external retailer or generated substitutes; client rendering remains outside server control.

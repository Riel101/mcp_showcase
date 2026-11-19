# Forme shared implementation contract

Portable Node 24, TypeScript, Express 5, node:sqlite persistence, React/Vite. Root cwd is project. Every amount is integer USD cents; UI formats dollars. No simulation labels in customer-facing content. Payment method is `store_credit`, called Forme balance; initial account balance 250000 cents. No card collection or real payment integration.

## Files / owners
- commerce agent: src/server/commerce.ts, src/server/catalog.ts, src/shared/commerce.ts, tests/commerce.test.ts. Own database/domain engine.
- identity/MCP agent: src/server/auth.ts, src/server/mcp.ts, tests/auth.test.ts. OAuth server, browser session auth, MCP SDK adapters.
- frontend agent: src/client/**, index.html, public/**. Complete responsive ecommerce frontend.
- root: src/server/index.ts, package config, integration tests, docs, review.

## Commerce API
`createCommerce(databasePath: string)` returns synchronous `Commerce` service with:
- `db`: DatabaseSync for auth tables (auth agent creates its own tables)
- `ensureCustomer(userId: string, email: string, name: string): void`
- `execute(action: string, input: Record<string, unknown>, userId?: string): unknown`
- `close(): void`
Errors: `CommerceError` with `.code`, `.status`, `.message` (export it).
Catalog product: `{id,slug,name,category,description,price,compareAtPrice?,currency:'USD',images:string[],colors:string[],features:string[],specs:Record<string,string>,stock:number,rating:number,reviewCount:number,badge?:string}`.
Cart result: `{items: [{productId,name,image,color,quantity,unitPrice,lineTotal}], subtotal,discount,shipping,total,currency:'USD',coupon:string|null,itemCount:number}`.
Order: `{id,status,items,subtotal,discount,shipping,total,currency,shippingAddress,shippingMethod,createdAt,events:[{status,at,description}],...}`.
Profile: `{id,email,name,balance,addresses:[{id,label,name,line1,line2?,city,region,postalCode,country}],...}`.

Action names/input/results:
- `discover_products` public: `{query?,category?,minPrice?,maxPrice?,inStock?,sort?:'recommended'|'price_asc'|'price_desc'|'rating',limit?:number,offset?:number}` -> `{products,total,categories:string[]}`. Default compact product list with full product fields for website, MCP can compact.
- `inspect_products` public: `{productIds:string[]}` -> `{products,comparison?:...}` (max 6)
- `get_store_policy` public: `{topic?:'all'|'shipping'|'returns'|'payments'|'privacy'}` -> structured policy
- `manage_cart` authenticated: `{operation:'view'|'add'|'update'|'remove'|'clear'|'apply_coupon'|'remove_coupon',items?:[{productId,quantity,color?}],coupon?:string}` -> cart. Quantity update 0 removes. Add requires positive integer.
- `manage_wishlist`: `{operation:'view'|'add'|'remove'|'move_to_cart',productIds?:string[]}` -> `{products}` or include cart
- `prepare_checkout`: `{addressId?:string,shippingAddress?:Address,shippingMethod?:'standard'|'express'}` -> `{quoteId,expiresAt,cart,shippingAddress,shippingMethod,paymentMethod:'store_credit',balance,canPlaceOrder}`. Locks price/address snapshot 15 minutes; invalidated if cart changed. Address requires name,line1,city,region,postalCode,country; optional id,label,line2.
- `place_order`: `{quoteId:string,idempotencyKey:string}` -> `{order,balance}`. Atomic stock debit, account debit, cart clear. User ownership. Repeat key returns original; key reused different quote rejects. Prevent double quote consumption.
- `track_orders`: `{orderId?:string,limit?:number}` -> `{orders}`. Deterministic fulfillment progresses over short elapsed periods so showcase tracking/returns possible; order events truthful to backend state. Cancellation pending/processing only; return delivered only.
- `change_order`: `{orderId,operation:'cancel'|'change_address',shippingAddress?:Address,reason?:string}` -> `{order,balance?}`. Cancellation restores inventory and balance once.
- `reorder`: `{orderId}` -> cart
- `request_return`: `{orderId,reason:string,productIds?:string[]}` -> `{return,order,balance}`. Support partial returns, no duplicate refunded lines. Refund to balance, restore inventory, within 30 days. Return has id/status/refund/items/createdAt/instructions.
- `manage_review`: `{operation:'list'|'submit',productId, rating?:number,title?:string,body?:string}` -> `{reviews}`. Read public; submit auth and delivered purchased product; one review/customer/product upsert.
- `contact_support`: `{subject:string,message:string,orderId?:string}` -> `{ticket}`. Must own order. No outgoing messages; persisted local support case.
- `list_support_requests`: `{ticketId?:string}` -> `{tickets}`
- `get_account`: `{}` -> profile
- `update_profile`: `{name?:string,address?:Address,removeAddressId?:string}` -> profile

MCP exposes all above tools except `update_profile` (account management website is allowed); get_account includes balance/saved shipping options. Tool names intention-oriented. Add meaningful concise descriptions, field docs, annotations. All outputs bounded. Auth required transport-wide; public website browsing possible. Website HTTP `GET /api/products`, `GET /api/products/:id`; all commerce via `POST /api/actions/:action` JSON; session cookie auth, same-origin mutation enforcement. `GET /api/session` -> `{user:null|{id,email,name}}`; `POST /api/auth/register` `{name,email,password}`; `POST /api/auth/login` `{email,password}`; `POST /api/auth/logout`. Successful auth -> `{user}`.

## Auth integration exports
`createAuth(commerce, {baseUrl: string})` returns `{router: express.Router, sessionUser(req): {id,email,name}|undefined, authenticateBearer(req): {id,email,name,scopes:string[]}|undefined}`.
Router owns `/api/auth/*`, `/api/session`, `/.well-known/*`, `/oauth/*`. Password scrypt hashing, secure random opaque hashed stored tokens, OAuth authorization code+S256 PKCE, exact redirect matching/loopback exception for native ports, refresh rotation, revocation, metadata. OAuth consent is separate purpose-built authorization page, NOT a shopping-page redirect; unauthenticated user can login within authorization page and resume grant. Secure cookies in HTTPS, HttpOnly sameSite=lax, reasonable TTL, CSRF origin checks and consent binding. Dynamic client registration supports localhost HTTP callbacks and HTTPS callbacks, no implicit grants. Scopes `commerce:read commerce:write`; mutations require write, reads require read. MCP resource `${baseUrl}/mcp` must be validated on grant/token. User can view and revoke connected grants under account.
`mountMcp(app, commerce, auth, {baseUrl})` mounts `/mcp` using SDK stateless streamable HTTP transport, resource metadata challenge, validates Origin when present, one server per request, cleanup. Export tool definitions if useful for tests. Browser API router mounted before SPA; JSON errors; no secret leakage.

## Frontend
Use `fetch` cookie same origin. Account create/login with real form; no preauthenticated shared demo customer. Cart/wishlist prompts sign in if required. Catalog browsable anonymously. Full cart, wishlist, product detail/reviews, checkout including address and shipping, order history/details/cancel/return/reorder/support, account addresses/balance/connected agents. Navigation can be client state or simple paths. Backend mount will serve index fallback. Brand: FORME. Editorial cream/ink/ochre, tasteful large product imagery, refined serif headlines, strong grid. No fake links or dummy controls. Hero/home, categories, search, sort, product details and functionality should all work. Connect agent pane with MCP URL and clear OAuth connection instructions useful to customers, not API internals.

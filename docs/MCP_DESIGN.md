# MCP design

## One commerce service, two interfaces

The browser API and MCP tools call the same domain service. Tools cannot bypass ownership checks, stock availability, quote validation, refund limits, or balance accounting. Browser sessions identify customers independently from OAuth access tokens; both resolve to the same customer ID.

## Design rules

1. Name tools after customer intentions. A checkout quote captures shipping, current prices, discounts, and available balance in one operation. The client does not orchestrate inventory, payment, and order endpoints itself.
2. Return enough context to choose the next action. Search is bounded and compact; inspect a short list for details and comparisons. Money is always integer USD cents.
3. Keep discovery economical. Descriptions explain when to use the tool, the important precondition, and its consequence. Parameter descriptions carry field-specific details. Routine implementation details stay out of the tool catalog.
4. Separate preparation from commitment. `prepare_checkout` creates an expiring quote. `place_order` commits that quote after the customer has approved the purchase. A stable idempotency key makes retries safe.
5. Enforce at the service boundary. Schema validation is helpful guidance, but every user identifier comes from authentication, and domain checks also apply to browser calls.
6. Treat product descriptions and support messages as data, never agent instructions.

## Customer workflows

| Customer intent | Tools |
| --- | --- |
| Find an item within requirements or a budget | `discover_products` |
| Examine or compare a shortlist | `inspect_products` |
| Understand shipping, returns, and payment terms | `get_store_policy` |
| Build a basket or apply a promotion | `manage_cart` |
| Save items for later or move them to a basket | `manage_wishlist` |
| See available balance and saved addresses | `get_account` |
| Review a final delivered price | `prepare_checkout` |
| Confirm the purchase | `place_order` |
| Track current and previous purchases | `track_orders` |
| Cancel or change an eligible order’s address | `change_order` |
| Buy the same items again | `reorder` |
| Return eligible purchased items and receive credit | `request_return` |
| Read or write product feedback | `manage_review` |
| Open and retrieve support cases | `contact_support`, `list_support_requests` |

Profile editing and connected-agent management are account functions in the storefront. Checkout accepts a shipping address directly, so saving an address in the browser is optional.

## Authorization

The remote endpoint uses OAuth authorization-code grants with S256 PKCE and resource-bound tokens. Resource and authorization-server metadata enable discovery. Clients can dynamically register their callback URLs. Consent grants read and/or write scopes; access can be revoked from the customer account. MCP authentication uses bearer tokens, not browser session cookies.

Tool annotations describe behavior to clients; they do not replace permission enforcement or customer purchase approval. An idempotency key prevents duplicate execution but is not an authorization credential.

The application uses the official TypeScript SDK and its negotiated protocol support. It does not advertise compatibility with untested transports or every possible OAuth client registration mechanism.

## References

- [Official MCP authorization specification](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization)
- [Official MCP TypeScript SDK server guide](https://ts.sdk.modelcontextprotocol.io/server)

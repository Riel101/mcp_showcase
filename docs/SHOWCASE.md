# Client presentation walkthrough

## Preparation

Start the application and create a customer account. Connect an OAuth-capable MCP client to the endpoint shown under Connect an agent. Keep the storefront open in another window under the same account to make cross-channel continuity visible.

Use natural-language requests like these; exact agent wording depends on the connected client.

## Discovery and comparison

> Find me a well-designed desk accessory under $150. Compare your best three options by price, materials, and everyday usefulness.

The agent discovers candidates, then inspects a shortlist instead of loading the entire catalog into context. Ask a follow-up constraint and observe the recommendation change.

## Purchase

> Add my preferred item to my cart. Apply FORME10. Deliver it to [a complete address] with standard shipping and show me the final total before placing the order.

The agent builds the cart and creates a quote. The quote includes the delivered price and balance. After reviewing it:

> Yes, place that order.

Refresh the storefront’s orders screen: the same order is present. No separate agent database, reconciliation step, or repeated website checkout is involved.

## Cross-channel continuity

Add a second product using the website. Then ask the agent:

> What is in my cart? Save that item to my wishlist and remove it from the cart.

The agent operates on the exact same customer state.

## After purchase

> Track my latest order.

> Reorder the items from that purchase, but show me the new total first.

> Return the [item] from my delivered order because it does not fit my space. Tell me the refund amount and what happens next.

Use a fresh order for cancellation while it is still eligible:

> Cancel the order I just placed.

Each operation follows the order’s current state. A rejected operation explains the applicable constraint instead of silently succeeding.

## Customer care and permissions

> Open a support case about my order and give me the case reference.

> Show my recent support requests.

Finally revoke the client from Account → Connected agents. Its token should no longer access customer data. Reconnect through OAuth when needed.

## Points to emphasize

- The value lies in complete customer workflows, not raw API coverage.
- The customer chooses their agent; the company owns the service, authorization, and business rules.
- Intent-based tools reduce unnecessary coordination and context while preserving control over purchases.
- The storefront remains a full shopping channel and an account-management destination.

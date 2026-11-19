import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { CallToolResult, ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import type { Express, Response } from "express";
import { z } from "zod";
import type { Order, Product, Review, SupportTicket } from "../shared/commerce.ts";
import { type Auth, readScope, writeScope } from "./auth.ts";
import { type Commerce, CommerceError } from "./commerce.ts";

const id = z.string().trim().min(1).max(80);
const productId = z.string().trim().min(1).max(120);
const orderId = id.describe("Order ID from checkout or order tracking.");
const productIds = z.array(productId).min(1).max(50);
const amount = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const text = (max: number) => z.string().trim().min(1).max(max);
const offset = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional().describe("Records to skip. Starts at 0.");

const shippingAddress = z.object({
  id: id.optional(),
  label: z.string().trim().max(50).optional(),
  name: text(120).describe("Recipient's full name."),
  line1: text(150).describe("Street address."),
  line2: z.string().trim().max(150).optional().describe("Apartment, suite, or unit."),
  city: text(100),
  region: text(100).describe("State or region."),
  postalCode: text(24),
  country: text(100).describe("Destination country."),
});

const readOnly: ToolAnnotations = {
  readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false,
};
const additive: ToolAnnotations = {
  readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false,
};
const destructive: ToolAnnotations = {
  readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false,
};

type ToolDefinition = {
  title: string;
  description: string;
  schema: z.ZodObject;
  annotations: ToolAnnotations;
  readOperation?: string;
};

const tools: Record<string, ToolDefinition> = {
  discover_products: {
    title: "Find products",
    description: "Search the Forme catalog by keywords, department, price or stock. Returns compact matches with the same primary image URLs used by the storefront, plus category names. Show only these image URLs; never substitute web-search photos. Use inspect_products for embedded photos. Prices are integer USD cents.",
    schema: z.object({
      query: text(150).optional().describe("Product name, material, feature or other keyword."),
      category: text(60).optional().describe("Department such as Home, Desk, Travel or Audio."),
      minPrice: amount.optional().describe("Minimum price in USD cents."),
      maxPrice: amount.optional().describe("Maximum price in USD cents."),
      inStock: z.boolean().optional().describe("Use true to show only available products."),
      sort: z.enum(["recommended", "price_asc", "price_desc", "rating"]).default("recommended"),
      limit: z.number().int().min(1).max(16).default(8).describe("Number of matches per page."),
      offset,
    }),
    annotations: readOnly,
  },
  inspect_products: {
    title: "Inspect products",
    description: "Inspect up to six products with specifications and actual storefront photos as MCP image content. Show the returned photos or their exact URLs, never external retailer or generated substitutes.",
    schema: z.object({
      productIds: productIds.max(6).describe("Product IDs or slugs from catalog search."),
      includeImages: z.boolean().default(true).describe("Embed primary storefront photos. Set false for text-only comparisons."),
    }),
    annotations: readOnly,
  },
  get_store_policy: {
    title: "Read store policies",
    description: "Check shipping, return eligibility, payment methods, current offers and privacy policies.",
    schema: z.object({
      topic: z.enum(["all", "shipping", "returns", "payments", "privacy"]).default("all"),
    }),
    annotations: readOnly,
  },
  manage_cart: {
    title: "Manage the shopping cart",
    description: "View the live cart, add products, set quantities, remove lines, clear the cart or manage a coupon. Cart totals are in USD cents.",
    schema: z.object({
      operation: z.enum(["view", "add", "update", "remove", "clear", "apply_coupon", "remove_coupon"]),
      items: z.array(z.object({
        productId: productId.describe("Product ID or slug."),
        quantity: z.number().int().min(0).max(99).optional().describe("Required for add and update. Add uses a positive increment. Update sets an absolute quantity, and 0 removes the line."),
        color: text(80).optional().describe("Exact color from product details. Defaults to the first available color."),
      })).min(1).max(50).optional().describe("Lines for add, update or remove."),
      coupon: text(40).optional().describe("Coupon code for apply_coupon."),
    }),
    annotations: destructive,
    readOperation: "view",
  },
  manage_wishlist: {
    title: "Manage saved products",
    description: "View, add or remove wishlist items, or move saved items into the cart at one unit each.",
    schema: z.object({
      operation: z.enum(["view", "add", "remove", "move_to_cart"]),
      productIds: productIds.optional().describe("Product IDs or slugs required when changing the wishlist."),
    }),
    annotations: destructive,
    readOperation: "view",
  },
  prepare_checkout: {
    title: "Quote checkout",
    description: "Quote the current cart with shipping and Forme balance. Returns a quote ID valid for 15 minutes unless the cart changes. Use the quote to review the total and destination before placing the order.",
    schema: z.object({
      addressId: id.optional().describe("Saved shipping address ID from get_account."),
      shippingAddress: shippingAddress.optional().describe("New destination. Provide this or addressId."),
      shippingMethod: z.enum(["standard", "express"]).default("standard"),
    }),
    annotations: additive,
  },
  place_order: {
    title: "Place an order",
    description: "Place an order only after the shopper approves the quoted items, total and destination. Charges the Forme balance and clears the cart. Reuse the same key when retrying the same quote.",
    schema: z.object({
      quoteId: id.describe("Unexpired ID from prepare_checkout."),
      idempotencyKey: text(160).describe("Unique key for this purchase. Keep it unchanged across retries."),
    }),
    annotations: { ...destructive, idempotentHint: true },
  },
  track_orders: {
    title: "Track orders",
    description: "List recent order summaries or inspect one order for its items, shipment events and return details.",
    schema: z.object({
      orderId: orderId.optional(),
      limit: z.number().int().min(1).max(20).default(8).describe("Number of summaries per page."),
      offset,
    }),
    annotations: readOnly,
  },
  change_order: {
    title: "Change or cancel an order",
    description: "Cancel or redirect an eligible pending or processing order. A cancellation credits the Forme balance and restores stock.",
    schema: z.object({
      orderId,
      operation: z.enum(["cancel", "change_address"]),
      shippingAddress: shippingAddress.optional().describe("New destination for change_address."),
      reason: text(500).optional().describe("Reason for cancellation."),
    }),
    annotations: destructive,
  },
  reorder: {
    title: "Reorder previous items",
    description: "Add an order's products, quantities and colors to the cart at current prices and availability.",
    schema: z.object({ orderId }),
    annotations: additive,
  },
  request_return: {
    title: "Return delivered items",
    description: "Return eligible products from a delivered order within 30 days. Returns a record, instructions and the refund credited to the Forme balance.",
    schema: z.object({
      orderId,
      reason: text(500).describe("Shopper's reason for returning the items."),
      productIds: productIds.optional().describe("Product IDs to return. Omit to return all eligible items remaining on the order."),
    }),
    annotations: destructive,
  },
  manage_review: {
    title: "Read or write product reviews",
    description: "List reviews for a product or submit your verified purchase review after delivery. Submitting again updates your review.",
    schema: z.object({
      operation: z.enum(["list", "submit"]),
      productId: productId.describe("Product ID or slug."),
      rating: z.number().int().min(1).max(5).optional().describe("Stars from 1 to 5 for submission."),
      title: text(100).optional().describe("Review title for submission."),
      body: text(1200).optional().describe("Review text for submission."),
      limit: z.number().int().min(1).max(10).default(6).describe("Reviews per page when listing."),
      offset,
    }),
    annotations: destructive,
    readOperation: "list",
  },
  contact_support: {
    title: "Open a support request",
    description: "Create a Forme support request for a question or problem. Optionally attach an order from your account.",
    schema: z.object({
      subject: text(120).describe("Short summary of the issue."),
      message: text(2000).describe("Details to include in the request."),
      orderId: orderId.optional(),
    }),
    annotations: additive,
  },
  list_support_requests: {
    title: "Check support requests",
    description: "List your recent support request summaries or read a specific request by ID.",
    schema: z.object({
      ticketId: id.optional().describe("Support request ID from contact_support or a list."),
      limit: z.number().int().min(1).max(20).default(8).describe("Number of summaries per page."),
      offset,
    }),
    annotations: readOnly,
  },
  get_account: {
    title: "Read your Forme account",
    description: "Get your Forme balance in USD cents and saved shipping address IDs for checkout.",
    schema: z.object({}),
    annotations: readOnly,
  },
};

function requiredScope(tool: ToolDefinition, input: Record<string, unknown> | undefined) {
  return tool.annotations.readOnlyHint || (tool.readOperation && input?.operation === tool.readOperation)
    ? readScope
    : writeScope;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function toolCall(message: unknown) {
  const request = record(message);
  if (request?.method !== "tools/call") return;
  const params = record(request.params);
  const name = params?.name;
  if (typeof name !== "string" || !Object.hasOwn(tools, name)) return;
  return { scope: requiredScope(tools[name], record(params?.arguments)), id: request.id };
}

function productSummary({ id, name, category, price, currency, stock, rating, badge, images }: Product) {
  return { id, name, category, price, currency, stock, rating, image: images[0], ...(badge && { badge }) };
}

function orderSummary(order: Order) {
  const { id, status, total, currency, createdAt, shippingMethod, items, events } = order;
  return {
    id, status, total, currency, createdAt, shippingMethod,
    itemCount: items.reduce((count, item) => count + item.quantity, 0),
    latestEvent: events.at(-1),
  };
}

function ticketSummary({ id, subject, orderId, status, createdAt }: SupportTicket) {
  return { id, subject, orderId, status, createdAt };
}

function compact(name: string, input: Record<string, unknown>, value: unknown): Record<string, unknown> {
  const result = record(value);
  if (!result) throw new Error("Unexpected commerce response.");
  if (name === "discover_products" || name === "manage_wishlist") {
    const products = (result.products as Product[]).map(productSummary);
    return { ...result, products };
  }
  if (name === "inspect_products") return { products: result.products };
  if (name === "track_orders" && !input.orderId) {
    return { ...result, orders: (result.orders as Order[]).map(orderSummary) };
  }
  if (name === "list_support_requests" && !input.ticketId) {
    return { ...result, tickets: (result.tickets as SupportTicket[]).map(ticketSummary) };
  }
  if (name === "manage_review" && input.operation === "submit") {
    return { ...result, reviews: (result.reviews as Review[]).slice(0, 6) };
  }
  return result;
}

function mediaLink(key: string, value: unknown, baseUrl: string): unknown {
  const absolute = (path: unknown) => typeof path === "string" && /^\/(?!\/)/.test(path) ? new URL(path, baseUrl).href : path;
  if (key === "image") return absolute(value);
  if (key === "images" && Array.isArray(value)) return value.map(absolute);
  return value;
}

function toolError(code: string, message: string): CallToolResult {
  const payload = { error: { code, message } };
  return {
    isError: true,
    content: [{ type: "text", text: JSON.stringify(payload) }],
    structuredContent: payload,
  };
}

function respondError(res: Response, status: number, code: number, message: string, id?: unknown) {
  res.status(status).json({
    jsonrpc: "2.0", id: typeof id === "string" || typeof id === "number" ? id : null, error: { code, message },
  });
}

export function mountMcp(app: Express, commerce: Commerce, auth: Auth, { baseUrl, fetchPhoto = (url: URL) => fetch(url, { redirect: "error", signal: AbortSignal.timeout(10000) }) }: { baseUrl: string; fetchPhoto?: (url: URL) => Promise<globalThis.Response> }) {
  const resourceMetadata = new URL("/.well-known/oauth-protected-resource/mcp", baseUrl).href;
  const challenge = `Bearer resource_metadata="${resourceMetadata}"`;

  app.all("/mcp", async (req, res) => {
    res.set("Cache-Control", "no-store").vary("Origin");
    const origin = req.get("origin");
    if (origin) {
      if (!auth.acceptsOrigin(origin)) return respondError(res, 403, -32003, "Origin is not allowed.");
      res.set({
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Expose-Headers": "WWW-Authenticate, MCP-Protocol-Version",
      });
    }
    if (req.method === "OPTIONS") {
      return res.set({
        "Access-Control-Allow-Headers": "Authorization, Content-Type, Accept, MCP-Protocol-Version, MCP-Session-Id, Last-Event-ID",
        "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
        "Access-Control-Max-Age": "600",
      }).status(204).end();
    }

    const user = auth.authenticateBearer(req);
    if (!user) {
      const error = req.get("authorization") ? ', error="invalid_token"' : "";
      res.set("WWW-Authenticate", `${challenge}, scope="${readScope} ${writeScope}"${error}`);
      return respondError(res, 401, -32001, "Connect your Forme account to continue.");
    }

    if (req.method !== "POST") {
      res.set("Allow", "POST, OPTIONS");
      return respondError(res, 405, -32601, "This endpoint accepts MCP messages over HTTP POST.");
    }

    const messages: unknown[] = Array.isArray(req.body) ? req.body : [req.body];
    const missing = messages.map(toolCall).find(call => call && !user.scopes.includes(call.scope));
    if (missing) {
      const needed = [...new Set([...user.scopes, missing.scope])].join(" ");
      res.set("WWW-Authenticate", `${challenge}, error="insufficient_scope", scope="${needed}"`);
      return respondError(res, 403, -32003, "This connection needs additional Forme permissions.", missing.id);
    }

    const server = new McpServer(
      { name: "forme-commerce", title: "Forme", version: "1.0.0", websiteUrl: new URL(baseUrl).origin },
      {
        instructions: "Shop Forme with the connected customer's account. Prices, balances and refunds use integer USD cents. Search for product IDs, then inspect products to verify details and color options. Show product photos using only the returned image URLs; do not substitute generated images or image-search results. Prepare a checkout quote before placing an authorized order.",
        capabilities: { tools: { listChanged: false } },
      },
    );
    for (const [name, tool] of Object.entries(tools)) {
      server.registerTool(name, {
        title: tool.title, description: tool.description, inputSchema: tool.schema, annotations: tool.annotations,
      }, async input => {
        if (!user.scopes.includes(requiredScope(tool, input))) {
          return toolError("insufficient_scope", "This connection needs additional Forme permissions.");
        }
        try {
          const value = commerce.execute(name, input, user.id);
          const projected = compact(name, input, value);
          const serialized = JSON.stringify(projected, (key, item) => mediaLink(key, item, baseUrl));
          if (Buffer.byteLength(serialized) > 48 * 1024) {
            return toolError("result_too_large", "This result exceeds the size limit. Request fewer records or a specific record.");
          }
          const content: CallToolResult["content"] = [{ type: "text", text: serialized }];
          if (name === "inspect_products" && input.includeImages !== false) {
            const photos = await Promise.all((projected.products as Product[]).map(async product => {
              const path = product.images[0];
              if (!/^\/images\/[a-z0-9-]+\.webp$/.test(path)) throw new Error("Invalid catalog photo path");
              const response = await fetchPhoto(new URL(path, baseUrl));
              if (!response.ok || !response.headers.get("content-type")?.includes("image/webp")) throw new Error("Catalog photo unavailable");
              const reader = response.body?.getReader();
              if (!reader) throw new Error("Catalog photo body missing");
              const chunks: Uint8Array[] = [];
              let size = 0;
              try {
                while (true) {
                  const { done, value } = await reader.read();
                  if (done) break;
                  size += value.byteLength;
                  if (size > 256 * 1024) throw new Error("Catalog photo exceeds size limit");
                  chunks.push(value);
                }
              } finally { await reader.cancel(); }
              return { product, data: Buffer.concat(chunks).toString("base64") };
            }));
            for (const { product, data } of photos) {
              content.push({ type: "text", text: `Official Forme photo: ${product.name} (${product.id}). ${new URL(product.images[0], baseUrl).href}` });
              content.push({ type: "image", data, mimeType: "image/webp" });
            }
          }
          return { content, structuredContent: JSON.parse(serialized) as Record<string, unknown> };
        } catch (error) {
          if (error instanceof CommerceError) return toolError(error.code, error.message);
          console.error("[forme] MCP tool failed:", name);
          return toolError("internal_error", "Forme could not complete this action. Please try again.");
        }
      });
    }

    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch {
      if (!res.headersSent) respondError(res, 500, -32603, "Forme could not process this MCP request.");
    } finally {
      await server.close();
    }
  });
}

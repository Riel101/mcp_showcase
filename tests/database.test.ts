import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { convertV4MiniflareOptions, Miniflare } from "miniflare";
import ts from "typescript";

const fixture = `
  import { DurableObject } from "cloudflare:workers";
  import { createCommerceWithDatabase, CommerceError } from "./commerce.js";
  import { createDurableDatabase } from "./database.js";

  export class CheckoutFixture extends DurableObject {
    constructor(ctx, env) {
      super(ctx, env);
      this.store = createCommerceWithDatabase(createDurableDatabase(ctx.storage));
    }
    exercise() {
      const store = this.store;
      const add = (products, userId) => store.execute("manage_cart", {
        operation: "add", items: products.map(productId => ({ productId, quantity: 1 })),
      }, userId);
      const quote = userId => store.execute("prepare_checkout", { shippingAddress: {
        name: "Test Shopper", line1: "10 Studio Street", city: "Lagos", region: "Lagos",
        postalCode: "100001", country: "Nigeria",
      } }, userId);
      const place = (quote, userId) => store.execute("place_order", {
        quoteId: quote.quoteId, idempotencyKey: userId,
      }, userId);
      const stock = productId => store.db.prepare("SELECT stock FROM inventory WHERE product_id = ?").get(productId).stock;
      store.ensureCustomer("alice", "alice@example.test", "Alice");
      store.ensureCustomer("bob", "bob@example.test", "Bob");
      store.db.prepare("UPDATE inventory SET stock = 1 WHERE product_id = ?").run("daily-mug");
      const pensBefore = stock("line-pen");
      add(["daily-mug"], "alice");
      add(["line-pen", "daily-mug"], "bob");
      const aliceQuote = quote("alice");
      const bobQuote = quote("bob");
      const purchase = place(aliceQuote, "alice");
      const retry = place(aliceQuote, "alice");
      let failure;
      try {
        place(bobQuote, "bob");
      } catch (error) {
        if (!(error instanceof CommerceError)) throw error;
        failure = error.code;
      }
      const afterFailure = {
        stock: stock("daily-mug"),
        pensAfter: stock("line-pen"),
        bobBalance: store.execute("get_account", {}, "bob").balance,
        bobCart: store.execute("manage_cart", { operation: "view" }, "bob").itemCount,
        bobOrders: store.execute("track_orders", {}, "bob").total,
      };
      const cancellation = store.execute("change_order", { operation: "cancel", orderId: purchase.order.id }, "alice");
      return {
        failure, pensBefore, afterFailure, sameOrder: retry.order.id === purchase.order.id,
        cancellationBalance: cancellation.balance, restocked: stock("daily-mug"),
      };
    }
  }

  export default {
    async fetch(_request, env) {
      const result = await env.STORE.getByName("checkout-fixture").exercise();
      return Response.json(result);
    },
  };
`;

async function loadModule(path: string, source: string) {
  const typescript = await readFile(new URL(source, import.meta.url), "utf8");
  const contents = ts.transpileModule(typescript, {
    compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.ESNext },
  }).outputText;
  return { type: "ESModule" as const, path, contents };
}

test("Durable Object SQLite rolls back a failed checkout after a prior line debit", { timeout: 45_000 }, async () => {
  const modules = await Promise.all([
    loadModule("commerce.js", "../src/server/commerce.ts"),
    loadModule("catalog.js", "../src/server/catalog.ts"),
    loadModule("database.js", "../src/cloudflare/database.ts"),
  ]);
  const worker = new Miniflare(convertV4MiniflareOptions({
    name: "forme-checkout-fixture",
    cf: false,
    compatibilityDate: "2026-11-19",
    modules: [{ type: "ESModule", path: "worker.js", contents: fixture }, ...modules],
    durableObjects: { STORE: { className: "CheckoutFixture", useSQLite: true } },
  }));
  try {
    const response = await worker.dispatchFetch("http://localhost");
    assert.equal(response.status, 200, response.status === 200 ? undefined : await response.text());
    const result = await response.json() as { pensBefore: number };
    assert.ok(Number.isInteger(result.pensBefore) && result.pensBefore > 0);
    assert.deepEqual(result, {
      failure: "insufficient_stock",
      pensBefore: result.pensBefore,
      afterFailure: { stock: 0, pensAfter: result.pensBefore, bobBalance: 250_000, bobCart: 2, bobOrders: 0 },
      sameOrder: true,
      cancellationBalance: 250_000,
      restocked: 1,
    });
  } finally {
    await worker.dispose();
  }
});

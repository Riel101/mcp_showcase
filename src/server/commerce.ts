import type {
  Address, AddressInput, Cart, CartItem, CheckoutQuote, Order, OrderEvent, OrderStatus,
  Product, Profile, ReturnRequest, Review, ShippingMethod, SupportTicket,
} from "../shared/commerce.js";
import { catalog, categories } from "./catalog.js";
import type { SqlDatabase } from "./database.js";

const INITIAL_BALANCE = 250_000;
const STANDARD_SHIPPING = 895;
const EXPRESS_SHIPPING = 1695;
const FREE_SHIPPING_AT = 10_000;
const COUPON = "FORME10";
const QUOTE_DURATION = 15 * 60_000;
const RETURN_DURATION = 30 * 24 * 60 * 60_000;
const MAX_CART_LINES = 50;
const MAX_ITEM_QUANTITY = 99;
const paymentMethod = "store_credit" as const;

const fulfillment: Record<ShippingMethod, Array<[number, OrderStatus, string]>> = {
  standard: [[4000, "processing", "Preparing your order."], [12_000, "shipped", "Your order has shipped."], [30_000, "delivered", "Your order was delivered."]],
  express: [[3000, "processing", "Preparing your order."], [8000, "shipped", "Your order has shipped."], [18_000, "delivered", "Your order was delivered."]],
};

const storePolicies = {
  shipping: {
    currency: "USD",
    methods: [
      { id: "standard", name: "Standard", price: STANDARD_SHIPPING, freeAt: FREE_SHIPPING_AT },
      { id: "express", name: "Express", price: EXPRESS_SHIPPING },
    ],
    summary: "Standard shipping is free on orders of $100 or more after discounts. Track your shipment in your account.",
  },
  returns: {
    daysAfterDelivery: 30,
    refundMethod: paymentMethod,
    summary: "Request a return within 30 days of delivery. Refunds cover the items after discounts and go to your Forme balance. Shipping charges are excluded from returns. Cancellations are available before shipping and refund the full order total.",
  },
  payments: {
    currency: "USD",
    methods: [{ id: paymentMethod, name: "Forme balance" }],
    currentOffers: [{ code: "FORME10", description: "10% off merchandise. Shipping is calculated after discounts." }],
    summary: "Orders are paid using your Forme balance. Your balance and order total appear before you place an order.",
  },
  privacy: {
    summary: "We use your account details to fulfill orders, manage returns, and respond to support requests. You can manage connected shopping assistants from your account.",
  },
};

export class CommerceError extends Error {
  constructor(public code: string, public status: number, message: string) {
    super(message);
    this.name = "CommerceError";
  }
}

export interface Commerce {
  db: SqlDatabase;
  ensureCustomer(userId: string, email: string, name: string): void;
  execute(action: string, input: Record<string, unknown>, userId?: string): unknown;
  close(): void;
}

type Input = Record<string, unknown>;
interface CustomerRow {
  id: string;
  email: string;
  name: string;
  balance: number;
  coupon: string | null;
  cart_revision: number;
}
interface CartLine {
  productId: string;
  color: string;
  quantity: number;
}
interface QuoteRow {
  document: string;
  expires_at: number;
  cart_revision: number;
  consumed: number;
}

function invalid(message: string): never {
  throw new CommerceError("invalid_input", 400, message);
}

function missing(message: string): never {
  throw new CommerceError("not_found", 404, message);
}

function conflict(code: string, message: string): never {
  throw new CommerceError(code, 409, message);
}

function readObject(value: unknown, field: string): Input {
  if (typeof value !== "object" || value === null || Array.isArray(value)) invalid(`${field} must be an object.`);
  return value as Input;
}

function readText(value: unknown, field: string, maxLength: number): string {
  if (typeof value !== "string") invalid(`${field} must be text.`);
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > maxLength || /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u.test(trimmed)) {
    invalid(`${field} must contain between 1 and ${maxLength} characters.`);
  }
  return trimmed;
}

function optionalText(value: unknown, field: string, maxLength: number): string | undefined {
  return value === undefined ? undefined : readText(value, field, maxLength);
}

function readInteger(value: unknown, field: string, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min || value > max) {
    invalid(`${field} must be an integer between ${min} and ${max}.`);
  }
  return value;
}

function readChoice<T extends string>(value: unknown, field: string, choices: readonly T[]): T {
  if (typeof value !== "string" || !choices.includes(value as T)) invalid(`${field} must be one of ${choices.join(", ")}.`);
  return value as T;
}

function readList(value: unknown, field: string, max: number): unknown[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > max) invalid(`${field} must contain between 1 and ${max} entries.`);
  return value;
}

function readAddress(value: unknown): AddressInput {
  const address = readObject(value, "Address");
  const line2 = address.line2 === "" ? undefined : optionalText(address.line2, "Address line 2", 150);
  const id = optionalText(address.id, "Address ID", 80);
  const label = address.label === "" ? undefined : optionalText(address.label, "Address label", 50);
  return {
    ...(id && { id }),
    ...(label && { label }),
    name: readText(address.name, "Recipient name", 120),
    line1: readText(address.line1, "Address line 1", 150),
    ...(line2 && { line2 }),
    city: readText(address.city, "City", 100),
    region: readText(address.region, "State or region", 100),
    postalCode: readText(address.postalCode, "Postal code", 24),
    country: readText(address.country, "Country", 100),
  };
}

function iso(timestamp: number): string {
  return new Date(timestamp).toISOString();
}

function publicId(prefix: string): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return `${prefix}-${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("").toUpperCase()}`;
}

function json<T>(document: string): T {
  return JSON.parse(document) as T;
}

function lineKey(line: Pick<CartLine, "productId" | "color">): string {
  return JSON.stringify([line.productId, line.color]);
}

function quantities(lines: CartLine[]): Map<string, number> {
  const totals = new Map<string, number>();
  for (const { productId, quantity } of lines) totals.set(productId, (totals.get(productId) ?? 0) + quantity);
  return totals;
}

function advanceOrder(order: Order, now: number): boolean {
  if (!["pending", "processing", "shipped"].includes(order.status)) return false;
  const createdAt = Date.parse(order.createdAt);
  let changed = false;
  for (const [offset, status, description] of fulfillment[order.shippingMethod]) {
    const at = createdAt + offset;
    if (now < at || order.events.some((event) => event.status === status)) continue;
    order.status = status;
    order.events.push({ status, at: iso(at), description });
    changed = true;
  }
  return changed;
}

export function createCommerceWithDatabase(db: SqlDatabase): Commerce {
  db.exec(`
    CREATE TABLE IF NOT EXISTS customers (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL,
      name TEXT NOT NULL,
      balance INTEGER NOT NULL CHECK (balance >= 0),
      coupon TEXT,
      cart_revision INTEGER NOT NULL DEFAULT 0
    ) STRICT;
    CREATE TABLE IF NOT EXISTS inventory (
      product_id TEXT PRIMARY KEY,
      stock INTEGER NOT NULL CHECK (stock >= 0)
    ) STRICT;
    CREATE TABLE IF NOT EXISTS cart_items (
      user_id TEXT NOT NULL REFERENCES customers(id),
      product_id TEXT NOT NULL REFERENCES inventory(product_id),
      color TEXT NOT NULL,
      quantity INTEGER NOT NULL CHECK (quantity > 0),
      PRIMARY KEY (user_id, product_id, color)
    ) STRICT;
    CREATE TABLE IF NOT EXISTS wishlist_items (
      user_id TEXT NOT NULL REFERENCES customers(id),
      product_id TEXT NOT NULL REFERENCES inventory(product_id),
      PRIMARY KEY (user_id, product_id)
    ) STRICT;
    CREATE TABLE IF NOT EXISTS shipping_addresses (
      user_id TEXT NOT NULL REFERENCES customers(id),
      id TEXT NOT NULL,
      document TEXT NOT NULL,
      PRIMARY KEY (user_id, id)
    ) STRICT;
    CREATE TABLE IF NOT EXISTS checkout_quotes (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES customers(id),
      cart_revision INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      consumed INTEGER NOT NULL DEFAULT 0,
      document TEXT NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS orders (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES customers(id),
      created_at INTEGER NOT NULL,
      document TEXT NOT NULL
    ) STRICT;
    CREATE INDEX IF NOT EXISTS orders_customer_dates ON orders(user_id, created_at DESC);
    CREATE TABLE IF NOT EXISTS order_idempotency (
      user_id TEXT NOT NULL REFERENCES customers(id),
      key TEXT NOT NULL,
      quote_id TEXT NOT NULL REFERENCES checkout_quotes(id),
      response TEXT NOT NULL,
      PRIMARY KEY (user_id, key)
    ) STRICT;
    CREATE TABLE IF NOT EXISTS order_returns (
      id TEXT PRIMARY KEY,
      order_id TEXT NOT NULL REFERENCES orders(id),
      document TEXT NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS product_reviews (
      product_id TEXT NOT NULL REFERENCES inventory(product_id),
      user_id TEXT NOT NULL REFERENCES customers(id),
      id TEXT NOT NULL UNIQUE,
      rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (product_id, user_id)
    ) STRICT;
    CREATE TABLE IF NOT EXISTS support_tickets (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES customers(id),
      created_at INTEGER NOT NULL,
      document TEXT NOT NULL
    ) STRICT;
    CREATE INDEX IF NOT EXISTS support_customer_dates ON support_tickets(user_id, created_at DESC);
  `);

  const catalogById = new Map(catalog.map((product) => [product.id, product]));
  const seedStock = db.prepare("INSERT INTO inventory (product_id, stock) VALUES (?, ?) ON CONFLICT DO NOTHING");
  db.transaction(() => {
    for (const product of catalog) seedStock.run(product.id, product.stock);
  });

  function ensureCustomer(userId: string, email: string, name: string): void {
    db.prepare(`
      INSERT INTO customers (id, email, name, balance) VALUES (?, ?, ?, ?)
      ON CONFLICT(id) DO NOTHING
    `).run(userId, email, name, INITIAL_BALANCE);
  }

  function customer(id?: string): CustomerRow {
    if (!id) throw new CommerceError("authentication_required", 401, "Sign in to continue.");
    const row = db.prepare("SELECT * FROM customers WHERE id = ?").get(id) as unknown as CustomerRow | undefined;
    if (!row) throw new CommerceError("authentication_required", 401, "Sign in to continue.");
    return row;
  }

  function catalogProduct(value: unknown): Product {
    const id = readText(value, "Product ID", 120);
    const product = catalogById.get(id);
    if (!product) missing(`Product ${id} was not found.`);
    return product;
  }

  function currentProducts(): Product[] {
    const rows = db.prepare(`
      SELECT inventory.product_id, inventory.stock, COALESCE(ROUND(AVG(reviews.rating), 1), 0) AS rating,
             COUNT(reviews.rating) AS review_count
      FROM inventory
      LEFT JOIN product_reviews AS reviews USING (product_id)
      GROUP BY inventory.product_id
    `).all() as Array<{ product_id: string; stock: number; rating: number; review_count: number }>;
    const inventory = new Map(rows.map((row) => [row.product_id, row]));
    return catalog.map((product) => {
      const row = inventory.get(product.id)!;
      return { ...product, stock: row.stock, rating: row.rating, reviewCount: row.review_count };
    });
  }

  function productsFromIds(value: unknown, max: number): Product[] {
    const ids = readList(value, "Product IDs", max).map((id) => catalogProduct(id).id);
    const current = new Map(currentProducts().map((product) => [product.id, product]));
    return Array.from(new Set(ids), (id) => current.get(id)!);
  }

  function discover(input: Input) {
    const query = input.query === "" ? "" : optionalText(input.query, "Search query", 160) ?? "";
    const searchTerms = query.toLowerCase().split(/\s+/u).filter(Boolean);
    const category = optionalText(input.category, "Category", 80)?.toLowerCase();
    const minPrice = input.minPrice === undefined ? 0 : readInteger(input.minPrice, "Minimum price", 0, Number.MAX_SAFE_INTEGER);
    const maxPrice = input.maxPrice === undefined ? Number.MAX_SAFE_INTEGER : readInteger(input.maxPrice, "Maximum price", 0, Number.MAX_SAFE_INTEGER);
    if (minPrice > maxPrice) invalid("Minimum price cannot exceed maximum price.");
    if (input.inStock !== undefined && typeof input.inStock !== "boolean") invalid("In stock must be true or false.");
    const sort = readChoice(input.sort ?? "recommended", "Sort", ["recommended", "price_asc", "price_desc", "rating"]);
    const limit = input.limit === undefined ? 24 : readInteger(input.limit, "Limit", 1, 50);
    const offset = input.offset === undefined ? 0 : readInteger(input.offset, "Offset", 0, Number.MAX_SAFE_INTEGER);
    const products = currentProducts().filter((product) => {
      if (category && product.category.toLowerCase() !== category) return false;
      if (product.price < minPrice || product.price > maxPrice) return false;
      if (input.inStock !== undefined && (product.stock > 0) !== input.inStock) return false;
      const searchable = [product.name, product.category, product.description, ...product.features, ...product.colors].join(" ").toLowerCase();
      return searchTerms.every((term) => searchable.includes(term));
    });
    if (sort === "price_asc") products.sort((a, b) => a.price - b.price);
    if (sort === "price_desc") products.sort((a, b) => b.price - a.price);
    if (sort === "rating") products.sort((a, b) => b.rating - a.rating || b.reviewCount - a.reviewCount);
    return { products: products.slice(offset, offset + limit), total: products.length, categories: [...categories] };
  }

  function inspect(input: Input) {
    const products = productsFromIds(input.productIds, 6);
    if (products.length === 1) return { products };
    const comparison = products.map(({ id, name, price, stock, rating, colors, specs }) => ({ productId: id, name, price, stock, rating, colors, specs }));
    return { products, comparison };
  }

  function policy(input: Input) {
    const topic = readChoice(input.topic ?? "all", "Policy topic", ["all", "shipping", "returns", "payments", "privacy"] as const);
    if (topic === "all") return { topic, ...storePolicies };
    return { topic, [topic]: storePolicies[topic] };
  }

  function cartLines(id: string): CartLine[] {
    return db.prepare(`
      SELECT product_id AS productId, color, quantity FROM cart_items WHERE user_id = ? ORDER BY rowid
    `).all(id) as unknown as CartLine[];
  }

  function stock(productId: string): number {
    const row = db.prepare("SELECT stock FROM inventory WHERE product_id = ?").get(productId);
    return Number(row?.stock ?? 0);
  }

  function inventoryAvailable(lines: CartLine[]): boolean {
    for (const [id, required] of quantities(lines)) if (stock(id) < required) return false;
    return true;
  }

  function makeCart(account: CustomerRow, method: ShippingMethod = "standard"): Cart {
    const items = cartLines(account.id).map((line) => {
      const product = catalogById.get(line.productId)!;
      return { ...line, name: product.name, image: product.images[0], unitPrice: product.price, lineTotal: product.price * line.quantity };
    });
    const subtotal = items.reduce((sum, item) => sum + item.lineTotal, 0);
    const discount = account.coupon === COUPON ? Math.floor(subtotal / 10) : 0;
    const merchandise = subtotal - discount;
    let shipping = 0;
    if (items.length > 0) {
      if (method === "express") shipping = EXPRESS_SHIPPING;
      else if (merchandise < FREE_SHIPPING_AT) shipping = STANDARD_SHIPPING;
    }
    return {
      items, subtotal, discount, shipping, total: merchandise + shipping, currency: "USD", coupon: account.coupon,
      itemCount: items.reduce((sum, item) => sum + item.quantity, 0),
    };
  }

  function bumpCart(id: string): void {
    db.prepare("UPDATE customers SET cart_revision = cart_revision + 1 WHERE id = ?").run(id);
  }

  function writeCartItems(id: string, operation: "add" | "update" | "remove", changes: CartLine[]): void {
    const previous = cartLines(id);
    const initial = quantities(previous);
    const lines = new Map(previous.map((line) => [lineKey(line), line]));
    const changed = new Map<string, CartLine>();
    for (const change of changes) {
      const key = lineKey(change);
      const existing = lines.get(key)?.quantity ?? 0;
      let quantity = change.quantity;
      if (operation === "add") quantity += existing;
      if (operation === "remove") quantity = 0;
      if (quantity === existing) continue;
      if (quantity > MAX_ITEM_QUANTITY) invalid(`A cart line can contain at most ${MAX_ITEM_QUANTITY} units.`);
      const line = { ...change, quantity };
      changed.set(key, line);
      if (quantity === 0) lines.delete(key);
      else lines.set(key, line);
    }
    if (lines.size > MAX_CART_LINES) invalid(`A cart can contain at most ${MAX_CART_LINES} different items.`);
    for (const [productId, total] of quantities([...lines.values()])) {
      if (total > (initial.get(productId) ?? 0) && total > stock(productId)) {
        conflict("insufficient_stock", `There is not enough stock for ${catalogById.get(productId)!.name}.`);
      }
    }
    if (changed.size === 0) return;
    const upsert = db.prepare(`
      INSERT INTO cart_items (user_id, product_id, color, quantity) VALUES (?, ?, ?, ?)
      ON CONFLICT(user_id, product_id, color) DO UPDATE SET quantity = excluded.quantity
    `);
    const remove = db.prepare("DELETE FROM cart_items WHERE user_id = ? AND product_id = ? AND color = ?");
    for (const { productId, color, quantity } of changed.values()) {
      if (quantity === 0) remove.run(id, productId, color);
      else upsert.run(id, productId, color, quantity);
    }
    bumpCart(id);
  }

  function manageCart(input: Input, userId?: string): Cart {
    const id = customer(userId).id;
    const operation = readChoice(input.operation, "Cart operation", ["view", "add", "update", "remove", "clear", "apply_coupon", "remove_coupon"] as const);
    if (operation === "view") return makeCart(customer(id));
    return db.transaction(() => {
      if (operation === "add" || operation === "update" || operation === "remove") {
        const changes = readList(input.items, "Cart items", MAX_CART_LINES).map((entry) => {
          const item = readObject(entry, "Cart item");
          const product = catalogProduct(item.productId);
          const color = item.color === undefined ? product.colors[0] : readChoice(item.color, "Color", product.colors);
          const quantity = operation === "remove" ? 0 : readInteger(item.quantity, "Quantity", operation === "add" ? 1 : 0, MAX_ITEM_QUANTITY);
          return { productId: product.id, color, quantity };
        });
        writeCartItems(id, operation, changes);
      } else if (operation === "clear") {
        const { changes } = db.prepare("DELETE FROM cart_items WHERE user_id = ?").run(id);
        if (changes || customer(id).coupon) {
          db.prepare("UPDATE customers SET coupon = NULL WHERE id = ?").run(id);
          bumpCart(id);
        }
      } else {
        const coupon = operation === "apply_coupon" ? readText(input.coupon, "Coupon", 40).toUpperCase() : null;
        if (coupon && coupon !== COUPON) invalid("That coupon is unavailable.");
        if (customer(id).coupon !== coupon) {
          db.prepare("UPDATE customers SET coupon = ? WHERE id = ?").run(coupon, id);
          bumpCart(id);
        }
      }
      return makeCart(customer(id));
    });
  }

  function wishlist(id: string): Product[] {
    const ids = db.prepare("SELECT product_id FROM wishlist_items WHERE user_id = ? ORDER BY rowid").all(id);
    const current = new Map(currentProducts().map((product) => [product.id, product]));
    return ids.map((row) => current.get(String(row.product_id))!);
  }

  function manageWishlist(input: Input, userId?: string) {
    const id = customer(userId).id;
    const operation = readChoice(input.operation, "Wishlist operation", ["view", "add", "remove", "move_to_cart"] as const);
    if (operation === "view") return { products: wishlist(id) };
    const products = productsFromIds(input.productIds, MAX_CART_LINES);
    return db.transaction(() => {
      const insert = db.prepare("INSERT INTO wishlist_items (user_id, product_id) VALUES (?, ?) ON CONFLICT DO NOTHING");
      const remove = db.prepare("DELETE FROM wishlist_items WHERE user_id = ? AND product_id = ?");
      if (operation === "add") for (const product of products) insert.run(id, product.id);
      if (operation === "remove") for (const product of products) remove.run(id, product.id);
      if (operation === "move_to_cart") {
        const saved = new Set(wishlist(id).map((product) => product.id));
        if (products.some((product) => !saved.has(product.id))) missing("A selected item is not in your wishlist.");
        writeCartItems(id, "add", products.map((product) => ({ productId: product.id, color: product.colors[0], quantity: 1 })));
        for (const product of products) remove.run(id, product.id);
        return { products: wishlist(id), cart: makeCart(customer(id)) };
      }
      return { products: wishlist(id) };
    });
  }

  function savedAddress(userId: string, addressId: string): Address {
    const row = db.prepare("SELECT document FROM shipping_addresses WHERE user_id = ? AND id = ?").get(userId, addressId);
    if (!row) missing("Shipping address was not found.");
    return json<Address>(String(row.document));
  }

  function prepareCheckout(input: Input, userId?: string): CheckoutQuote {
    const id = customer(userId).id;
    const method = readChoice(input.shippingMethod ?? "standard", "Shipping method", ["standard", "express"] as const);
    if (input.addressId !== undefined && input.shippingAddress !== undefined) invalid("Choose a saved address or enter a shipping address.");
    return db.transaction(() => {
      const account = customer(id);
      const cart = makeCart(account, method);
      if (cart.items.length === 0) conflict("empty_cart", "Add an item to your cart before checking out.");
      let shippingAddress: AddressInput;
      if (input.addressId !== undefined) shippingAddress = savedAddress(id, readText(input.addressId, "Address ID", 80));
      else shippingAddress = readAddress(input.shippingAddress);
      const quoteId = crypto.randomUUID();
      const expiresAt = Date.now() + QUOTE_DURATION;
      const quote: CheckoutQuote = {
        quoteId, expiresAt: iso(expiresAt), cart, shippingAddress, shippingMethod: method, paymentMethod,
        balance: account.balance, canPlaceOrder: account.balance >= cart.total && inventoryAvailable(cart.items),
      };
      db.prepare(`
        INSERT INTO checkout_quotes (id, user_id, cart_revision, expires_at, document) VALUES (?, ?, ?, ?, ?)
      `).run(quoteId, id, account.cart_revision, expiresAt, JSON.stringify(quote));
      return quote;
    });
  }

  function placeOrder(input: Input, userId?: string): { order: Order; balance: number } {
    const id = customer(userId).id;
    const quoteId = readText(input.quoteId, "Quote ID", 80);
    const key = readText(input.idempotencyKey, "Idempotency key", 160);
    return db.transaction(() => {
      const prior = db.prepare("SELECT quote_id, response FROM order_idempotency WHERE user_id = ? AND key = ?").get(id, key);
      if (prior) {
        if (prior.quote_id !== quoteId) conflict("idempotency_conflict", "This idempotency key was used for a different checkout quote.");
        return json<{ order: Order; balance: number }>(String(prior.response));
      }
      const account = customer(id);
      const row = db.prepare(`
        SELECT document, expires_at, cart_revision, consumed FROM checkout_quotes WHERE id = ? AND user_id = ?
      `).get(quoteId, id) as unknown as QuoteRow | undefined;
      if (!row) missing("Checkout quote was not found.");
      if (row.consumed) conflict("quote_consumed", "An order has already been placed for this checkout quote.");
      const now = Date.now();
      if (row.expires_at <= now) conflict("quote_expired", "Your checkout quote has expired. Prepare checkout again.");
      if (row.cart_revision !== account.cart_revision) conflict("cart_changed", "Your cart changed. Prepare checkout again.");
      const { cart, shippingAddress, shippingMethod } = json<CheckoutQuote>(row.document);
      if (account.balance < cart.total) conflict("insufficient_balance", "Your Forme balance is lower than the order total.");
      const debitStock = db.prepare("UPDATE inventory SET stock = stock - ? WHERE product_id = ? AND stock >= ?");
      for (const [productId, quantity] of quantities(cart.items)) {
        if (!debitStock.run(quantity, productId, quantity).changes) {
          conflict("insufficient_stock", `There is not enough stock for ${catalogById.get(productId)!.name}.`);
        }
      }
      const createdAt = iso(now);
      const order: Order = {
        id: publicId("FM"), status: "pending", items: cart.items, subtotal: cart.subtotal, discount: cart.discount,
        shipping: cart.shipping, total: cart.total, currency: "USD", coupon: cart.coupon,
        shippingAddress, shippingMethod, paymentMethod, createdAt, returnedProductIds: [],
        events: [{ status: "pending", at: createdAt, description: "Your order was placed." }],
      };
      const balance = account.balance - cart.total;
      db.prepare("UPDATE customers SET balance = ?, coupon = NULL, cart_revision = cart_revision + 1 WHERE id = ?").run(balance, id);
      db.prepare("DELETE FROM cart_items WHERE user_id = ?").run(id);
      db.prepare("UPDATE checkout_quotes SET consumed = 1 WHERE id = ?").run(quoteId);
      db.prepare("INSERT INTO orders (id, user_id, created_at, document) VALUES (?, ?, ?, ?)").run(order.id, id, now, JSON.stringify(order));
      const response = { order, balance };
      db.prepare("INSERT INTO order_idempotency (user_id, key, quote_id, response) VALUES (?, ?, ?, ?)").run(id, key, quoteId, JSON.stringify(response));
      return response;
    });
  }

  function orderFor(userId: string, orderId: string): Order {
    const row = db.prepare("SELECT document FROM orders WHERE id = ? AND user_id = ?").get(orderId, userId);
    if (!row) missing("Order was not found.");
    return withReturns(json<Order>(String(row.document)));
  }

  function withReturns(order: Order): Order {
    order.returns = db.prepare("SELECT document FROM order_returns WHERE order_id = ? ORDER BY rowid").all(order.id).map(row => json<ReturnRequest>(String(row.document)));
    return order;
  }

  function saveOrder(order: Order): void {
    db.prepare("UPDATE orders SET document = ? WHERE id = ?").run(JSON.stringify(order), order.id);
  }

  function trackOrders(input: Input, userId?: string): { orders: Order[]; total: number; hasMore: boolean } {
    const id = customer(userId).id;
    const orderId = optionalText(input.orderId, "Order ID", 80);
    const limit = input.limit === undefined ? 10 : readInteger(input.limit, "Limit", 1, 25);
    const offset = input.offset === undefined ? 0 : readInteger(input.offset, "Offset", 0, Number.MAX_SAFE_INTEGER);
    return db.transaction(() => {
      const orders = orderId ? [orderFor(id, orderId)] : db.prepare(`
        SELECT document FROM orders WHERE user_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ? OFFSET ?
      `).all(id, limit, offset).map((row) => withReturns(json<Order>(String(row.document))));
      const now = Date.now();
      for (const order of orders) if (advanceOrder(order, now)) saveOrder(order);
      const total = orderId ? 1 : Number(db.prepare("SELECT COUNT(*) AS total FROM orders WHERE user_id = ?").get(id)!.total);
      return { orders, total, hasMore: !orderId && offset + orders.length < total };
    });
  }

  function refund(id: string, items: CartItem[], amount: number): number {
    const restock = db.prepare("UPDATE inventory SET stock = stock + ? WHERE product_id = ?");
    for (const [productId, quantity] of quantities(items)) restock.run(quantity, productId);
    db.prepare("UPDATE customers SET balance = balance + ? WHERE id = ?").run(amount, id);
    return customer(id).balance;
  }

  function changeOrder(input: Input, userId?: string): { order: Order; balance?: number } {
    const id = customer(userId).id;
    const orderId = readText(input.orderId, "Order ID", 80);
    const operation = readChoice(input.operation, "Order operation", ["cancel", "change_address"] as const);
    return db.transaction(() => {
      const order = orderFor(id, orderId);
      const now = Date.now();
      advanceOrder(order, now);
      if (order.status !== "pending" && order.status !== "processing") {
        conflict("order_locked", "Only orders awaiting shipment can be changed or cancelled.");
      }
      const at = iso(now);
      if (operation === "change_address") {
        order.shippingAddress = readAddress(input.shippingAddress);
        order.events.push({ status: order.status, at, description: "The shipping address was updated." });
        saveOrder(order);
        return { order };
      }
      const reason = optionalText(input.reason, "Cancellation reason", 500);
      order.status = "cancelled";
      if (reason) order.cancellationReason = reason;
      order.events.push({ status: "cancelled", at, description: "Your order was cancelled and refunded to your Forme balance." });
      const balance = refund(id, order.items, order.total);
      saveOrder(order);
      return { order, balance };
    });
  }

  function reorder(input: Input, userId?: string): Cart {
    const id = customer(userId).id;
    const orderId = readText(input.orderId, "Order ID", 80);
    return db.transaction(() => {
      const order = orderFor(id, orderId);
      const lines = order.items.map(({ productId, color, quantity }) => {
        const product = catalogProduct(productId);
        readChoice(color, "Color", product.colors);
        return { productId, color, quantity };
      });
      writeCartItems(id, "add", lines);
      return makeCart(customer(id));
    });
  }

  function requestReturn(input: Input, userId?: string): { return: ReturnRequest; order: Order; balance: number } {
    const id = customer(userId).id;
    const orderId = readText(input.orderId, "Order ID", 80);
    const reason = readText(input.reason, "Return reason", 500);
    return db.transaction(() => {
      const order = orderFor(id, orderId);
      const now = Date.now();
      advanceOrder(order, now);
      if (order.status === "returned") conflict("already_returned", "All items in this order have already been returned.");
      if (order.status !== "delivered" && order.status !== "partially_returned") {
        conflict("order_not_delivered", "Returns are available after delivery.");
      }
      const delivered = order.events.find((event) => event.status === "delivered")!;
      if (now > Date.parse(delivered.at) + RETURN_DURATION) conflict("return_window_closed", "The 30-day return window has closed.");
      const orderProducts = new Set(order.items.map((item) => item.productId));
      const returned = new Set(order.returnedProductIds);
      const selected = input.productIds === undefined
        ? new Set([...orderProducts].filter((productId) => !returned.has(productId)))
        : new Set(readList(input.productIds, "Product IDs", MAX_CART_LINES).map((productId) => readText(productId, "Product ID", 120)));
      for (const productId of selected) {
        if (!orderProducts.has(productId)) missing("A selected product was not part of this order.");
        if (returned.has(productId)) conflict("already_returned", "A selected product has already been returned.");
      }
      const items = order.items.filter((item) => selected.has(item.productId));
      let cumulativeSubtotal = 0;
      let refundAmount = 0;
      // Allocate discount cents by cumulative line value, so any sequence of returns yields the same refund.
      for (const item of order.items) {
        const priorDiscount = Math.floor(cumulativeSubtotal * order.discount / order.subtotal);
        cumulativeSubtotal += item.lineTotal;
        if (selected.has(item.productId)) {
          const lineDiscount = Math.floor(cumulativeSubtotal * order.discount / order.subtotal) - priorDiscount;
          refundAmount += item.lineTotal - lineDiscount;
        }
      }
      const record: ReturnRequest = {
        id: publicId("RT"), status: "refunded", refund: refundAmount, items, createdAt: iso(now), reason,
        instructions: "Your refund is available in your Forme balance. Include the return reference when contacting Forme support for return shipping instructions.",
      };
      for (const productId of selected) returned.add(productId);
      order.returnedProductIds = [...returned];
      order.status = returned.size === orderProducts.size ? "returned" : "partially_returned";
      order.events.push({ status: order.status, at: record.createdAt, description: `Return ${record.id} was refunded to your Forme balance.` });
      const balance = refund(id, items, refundAmount);
      db.prepare("INSERT INTO order_returns (id, order_id, document) VALUES (?, ?, ?)").run(record.id, order.id, JSON.stringify(record));
      saveOrder(order);
      return { return: record, order, balance };
    });
  }

  function reviews(productId: string, limit = 40, offset = 0): Review[] {
    return db.prepare(`
      SELECT reviews.id, reviews.product_id AS productId, customers.name, reviews.rating, reviews.title, reviews.body,
             reviews.created_at AS createdAt, reviews.updated_at AS updatedAt
      FROM product_reviews AS reviews JOIN customers ON customers.id = reviews.user_id
      WHERE reviews.product_id = ? ORDER BY reviews.updated_at DESC, reviews.id DESC LIMIT ? OFFSET ?
    `).all(productId, limit, offset).map((row) => {
      const review = row as unknown as Review;
      const words = review.name.split(/\s+/u);
      const name = words.length === 1 ? words[0] : `${words[0]} ${Array.from(words.at(-1)!)[0]}.`;
      return { ...review, name };
    });
  }

  function manageReview(input: Input, userId?: string): { reviews: Review[]; total?: number; hasMore?: boolean } {
    const operation = readChoice(input.operation, "Review operation", ["list", "submit"] as const);
    const product = catalogProduct(input.productId);
    if (operation === "list") {
      const limit = input.limit === undefined ? 10 : readInteger(input.limit, "Limit", 1, 40);
      const offset = input.offset === undefined ? 0 : readInteger(input.offset, "Offset", 0, Number.MAX_SAFE_INTEGER);
      const list = reviews(product.id, limit, offset);
      const total = Number(db.prepare("SELECT COUNT(*) AS total FROM product_reviews WHERE product_id = ?").get(product.id)!.total);
      return { reviews: list, total, hasMore: offset + list.length < total };
    }
    const id = customer(userId).id;
    const rating = readInteger(input.rating, "Rating", 1, 5);
    const title = readText(input.title, "Review title", 100);
    const body = readText(input.body, "Review", 1200);
    return db.transaction(() => {
      const now = Date.now();
      const purchased = db.prepare(`
        SELECT orders.document FROM orders, json_each(orders.document, '$.items') AS line
        WHERE orders.user_id = ? AND json_extract(line.value, '$.productId') = ?
      `).iterate(id, product.id);
      let delivered = false;
      for (const row of purchased) {
        const order = json<Order>(String(row.document));
        if (advanceOrder(order, now)) saveOrder(order);
        if (order.events.some((event) => event.status === "delivered")) {
          delivered = true;
          break;
        }
      }
      if (!delivered) conflict("verified_purchase_required", "You can review an item after it is delivered to you.");
      const at = iso(now);
      db.prepare(`
        INSERT INTO product_reviews (id, user_id, product_id, rating, title, body, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(product_id, user_id) DO UPDATE SET rating = excluded.rating,
          title = excluded.title, body = excluded.body, updated_at = excluded.updated_at
      `).run(crypto.randomUUID(), id, product.id, rating, title, body, at, at);
      return { reviews: reviews(product.id) };
    });
  }

  function contactSupport(input: Input, userId?: string): { ticket: SupportTicket } {
    const id = customer(userId).id;
    const subject = readText(input.subject, "Subject", 120);
    const message = readText(input.message, "Message", 2000);
    const orderId = optionalText(input.orderId, "Order ID", 80);
    if (orderId) orderFor(id, orderId);
    const now = Date.now();
    const ticket: SupportTicket = { id: publicId("CS"), subject, message, ...(orderId && { orderId }), status: "open", createdAt: iso(now) };
    db.prepare("INSERT INTO support_tickets (id, user_id, created_at, document) VALUES (?, ?, ?, ?)").run(ticket.id, id, now, JSON.stringify(ticket));
    return { ticket };
  }

  function listSupport(input: Input, userId?: string): { tickets: SupportTicket[]; total: number; hasMore: boolean } {
    const id = customer(userId).id;
    const ticketId = optionalText(input.ticketId, "Ticket ID", 80);
    if (ticketId) {
      const row = db.prepare("SELECT document FROM support_tickets WHERE id = ? AND user_id = ?").get(ticketId, id);
      if (!row) missing("Support request was not found.");
      return { tickets: [json<SupportTicket>(String(row.document))], total: 1, hasMore: false };
    }
    const limit = input.limit === undefined ? 10 : readInteger(input.limit, "Limit", 1, 25);
    const offset = input.offset === undefined ? 0 : readInteger(input.offset, "Offset", 0, Number.MAX_SAFE_INTEGER);
    const total = Number(db.prepare("SELECT COUNT(*) AS total FROM support_tickets WHERE user_id = ?").get(id)!.total);
    const rows = db.prepare(`
      SELECT document FROM support_tickets WHERE user_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ? OFFSET ?
    `).all(id, limit, offset);
    return { tickets: rows.map((row) => json<SupportTicket>(String(row.document))), total, hasMore: offset + rows.length < total };
  }

  function profile(id: string): Profile {
    const { email, name, balance } = customer(id);
    const addresses = db.prepare("SELECT document FROM shipping_addresses WHERE user_id = ? ORDER BY rowid").all(id);
    return { id, email, name, balance, currency: "USD", addresses: addresses.map((row) => json<Address>(String(row.document))) };
  }

  function updateProfile(input: Input, userId?: string): Profile {
    const id = customer(userId).id;
    const name = optionalText(input.name, "Name", 120);
    const removeAddressId = optionalText(input.removeAddressId, "Address ID", 80);
    const address = input.address === undefined ? undefined : readAddress(input.address);
    if (removeAddressId && address?.id === removeAddressId) invalid("An address cannot be updated and removed together.");
    return db.transaction(() => {
      if (name) db.prepare("UPDATE customers SET name = ? WHERE id = ?").run(name, id);
      if (removeAddressId) {
        if (!db.prepare("DELETE FROM shipping_addresses WHERE user_id = ? AND id = ?").run(id, removeAddressId).changes) {
          missing("Shipping address was not found.");
        }
      }
      if (address) {
        const previous = address.id ? savedAddress(id, address.id) : undefined;
        if (!previous && profile(id).addresses.length >= 20) invalid("You can save up to 20 shipping addresses.");
        const record: Address = { ...address, id: previous?.id ?? crypto.randomUUID(), label: address.label ?? previous?.label ?? "Shipping address" };
        db.prepare(`
          INSERT INTO shipping_addresses (user_id, id, document) VALUES (?, ?, ?)
          ON CONFLICT(user_id, id) DO UPDATE SET document = excluded.document
        `).run(id, record.id, JSON.stringify(record));
      }
      return profile(id);
    });
  }

  const actions = new Map<string, (input: Input, userId?: string) => unknown>([
    ["discover_products", discover],
    ["inspect_products", inspect],
    ["get_store_policy", policy],
    ["manage_cart", manageCart],
    ["manage_wishlist", manageWishlist],
    ["prepare_checkout", prepareCheckout],
    ["place_order", placeOrder],
    ["track_orders", trackOrders],
    ["change_order", changeOrder],
    ["reorder", reorder],
    ["request_return", requestReturn],
    ["manage_review", manageReview],
    ["contact_support", contactSupport],
    ["list_support_requests", listSupport],
    ["get_account", (_input, userId) => profile(customer(userId).id)],
    ["update_profile", updateProfile],
  ]);

  return {
    db,
    ensureCustomer,
    execute(action, input, userId) {
      const handler = actions.get(action);
      if (!handler) missing("That shopping action was not found.");
      return handler(readObject(input, "Input"), userId);
    },
    close: () => db.close(),
  };
}

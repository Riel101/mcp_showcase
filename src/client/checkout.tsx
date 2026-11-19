import { useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowLeft, ArrowRight, Check, ChevronRight, LockKeyhole, ShoppingBag, Tag, Truck, Wallet, X } from "lucide-react";
import type { Cart, CartItem, CheckoutQuote, Order, Profile, ShippingMethod } from "../shared/commerce";
import { action, dollars, messageOf, post } from "./api";
import { Link, useShop, type User } from "./context";
import { AddressFields, AddressText, Empty, ErrorMessage, Loading, Modal, ProductImage, Quantity, Totals, getAddress } from "./ui";

export function AuthOverlay({ onClose, purpose, onSuccess }: { onClose: () => void; purpose: string; onSuccess: (user: User) => void }) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setPending(true);
    setError("");
    try {
      const { user } = await post<{ user: User }>(`/api/auth/${mode}`, { name: form.get("name") ?? undefined, email: form.get("email"), password: form.get("password") });
      onSuccess(user);
    } catch (reason) { setError(messageOf(reason)); }
    finally { setPending(false); }
  }
  return <Modal title={mode === "login" ? "Sign in to FORME" : "Create your account"} onClose={onClose}>
    <div className="auth-tabs" role="group" aria-label="Account access">
      <button type="button" className={mode === "login" ? "active" : ""} aria-pressed={mode === "login"} disabled={pending} onClick={() => { setMode("login"); setError(""); }}>Sign in</button>
      <button type="button" className={mode === "register" ? "active" : ""} aria-pressed={mode === "register"} disabled={pending} onClick={() => { setMode("register"); setError(""); }}>Create account</button>
    </div>
    <p className="muted">{mode === "login" ? purpose || "Access your orders, saved objects, and Forme balance." : "Save your favorites, manage orders, and check out with your Forme balance."}</p>
    <form className="form-stack" onSubmit={submit}>
      {mode === "register" && <label className="field"><span>Full name</span><input name="name" autoComplete="name" required maxLength={100} /></label>}
      <label className="field"><span>Email address</span><input type="email" name="email" autoComplete="email" maxLength={254} required data-autofocus /></label>
      <label className="field"><span>Password</span><input type="password" name="password" autoComplete={mode === "login" ? "current-password" : "new-password"} minLength={mode === "register" ? 8 : undefined} maxLength={128} required />
        {mode === "register" && <small>Use at least eight characters.</small>}</label>
      <ErrorMessage>{error}</ErrorMessage>
      <button className="button" type="submit" disabled={pending}>{pending ? "Please wait…" : mode === "login" ? "Sign in" : "Create account"} <ArrowRight size={17} /></button>
    </form>
  </Modal>;
}

export function LineItems({ items, controls, pending = false }: { items: CartItem[]; controls?: (item: CartItem, quantity?: number) => void; pending?: boolean }) {
  return <ul className="line-items">{items.map((item) => <li key={`${item.productId}:${item.color}`} className="line-item">
    <Link className="line-photo" href={`/product/${encodeURIComponent(item.productId)}`} label={`View ${item.name}`}><ProductImage src={item.image} alt="" /></Link>
    <div className="line-content"><Link href={`/product/${encodeURIComponent(item.productId)}`}>{item.name}</Link>
      <small>{item.color}{controls ? "" : ` · Qty ${item.quantity}`}</small>
      {controls && <div className="line-actions"><Quantity value={item.quantity} onChange={(quantity) => controls(item, quantity)} disabled={pending} label={`Quantity for ${item.name} in ${item.color}`} />
        <button type="button" className="text-button" onClick={() => controls(item)} aria-label={`Remove ${item.name} in ${item.color}`} disabled={pending}>Remove</button></div>}
    </div><strong className="line-price">{dollars(item.lineTotal)}</strong>
  </li>)}</ul>;
}

export function CouponForm({ cart, onChange }: { cart: Cart; onChange?: () => void }) {
  const { editCart, notify } = useShop();
  const [coupon, setCoupon] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  async function apply(value?: string) {
    if (pending) return;
    setError("");
    setPending(true);
    try {
      await editCart(value ? { operation: "apply_coupon", coupon: value } : { operation: "remove_coupon" });
      setCoupon("");
      onChange?.();
      notify(value ? "Discount applied." : "Discount code removed.");
    } catch (reason) { setError(messageOf(reason)); }
    finally { setPending(false); }
  }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (coupon.trim()) void apply(coupon.trim());
  }

  return <div className="coupon">
    {cart.coupon ? <div className="coupon-applied"><Tag size={16} /><strong>{cart.coupon}</strong><span>Applied</span>
      <button type="button" className="icon-button" onClick={() => void apply()} disabled={pending} aria-label="Remove discount code"><X size={17} /></button></div>
      : <form className="coupon-form" onSubmit={submit}><label className="sr-only" htmlFor="coupon">Discount code</label><Tag size={16} aria-hidden="true" />
        <input id="coupon" value={coupon} onChange={(event) => setCoupon(event.target.value)} placeholder="Discount code" maxLength={40} />
        <button className="text-button" type="submit" disabled={pending || !coupon.trim()}>{pending ? "Applying…" : "Apply"}</button>
      </form>}
    <ErrorMessage>{error}</ErrorMessage>
  </div>;
}

export function CartOverlay({ onClose }: { onClose: () => void }) {
  const { user, sessionPending, cart, requireUser, editCart, setOverlay } = useShop();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  async function changeLine(item: CartItem, quantity?: number) {
    setPending(true);
    setError("");
    try {
      await editCart({ operation: quantity === undefined ? "remove" : "update", items: [{ productId: item.productId, color: item.color, quantity: quantity ?? 0 }] });
    } catch (reason) { setError(messageOf(reason)); }
    finally { setPending(false); }
  }
  function retry() {
    setPending(true);
    setError("");
    editCart({ operation: "view" }).catch((reason: unknown) => setError(messageOf(reason))).finally(() => setPending(false));
  }
  const subtotal = cart ? cart.subtotal - cart.discount : 0;
  const freeGap = Math.max(0, 10000 - subtotal);
  return <Modal drawer title={`Shopping bag${cart?.itemCount ? ` (${cart.itemCount})` : ""}`} onClose={onClose} footer={cart?.items.length ? <>
    <Totals {...cart} />
    <Link className="button" href="/checkout">Checkout <ArrowRight size={19} /></Link>
    <p className="secure-note"><LockKeyhole size={14} /> Secure checkout with Forme balance</p>
  </> : undefined}>
    {sessionPending ? <Loading>Checking your bag…</Loading> : !user ? <div className="empty-state">
      <ShoppingBag size={30} strokeWidth={1.35} /><h2>Your shopping bag</h2><p>Sign in to view or add objects to your bag.</p>
      <button className="button" type="button" onClick={() => requireUser(() => setOverlay("cart"), "Sign in to open your bag.")}>Sign in <ArrowRight size={19} /></button>
    </div> : cart ? cart.items.length ? <>
      <div className="shipping-progress">
        <p><Truck size={18} strokeWidth={1.6} />{freeGap ? <span>You’re <strong>{dollars(freeGap)}</strong> away from free standard shipping.</span> : <span>Your order qualifies for <strong>free standard shipping.</strong></span>}</p>
        <progress value={Math.min(subtotal, 10000)} max={10000} aria-label="Progress toward free standard shipping" />
      </div>
      <LineItems items={cart.items} controls={changeLine} pending={pending} />
      <ErrorMessage>{error}</ErrorMessage>
      <CouponForm cart={cart} />
    </> : <div className="empty-state"><ShoppingBag size={30} strokeWidth={1.4} /><h2>Your bag is empty</h2><p>Explore the collection to find your everyday objects.</p>
      <Link className="button" href="/shop">Explore the collection <ArrowRight size={18} /></Link></div>
      : pending ? <Loading>Loading your bag…</Loading> : <div className="empty-state"><Loading>Retrieving your bag…</Loading><button type="button" className="text-button" onClick={retry}>Refresh bag</button><ErrorMessage>{error}</ErrorMessage></div>}
  </Modal>;
}

export function Checkout() {
  const { user, cart, setCart, setOverlay, navigate, requireUser, sessionPending, editCart, notify } = useShop();
  const [profile, setProfile] = useState<Profile>();
  const [profileError, setProfileError] = useState("");
  const [profileRetry, setProfileRetry] = useState(0);
  const [addressId, setAddressId] = useState("new");
  const [method, setMethod] = useState<ShippingMethod>("standard");
  const [quote, setQuote] = useState<CheckoutQuote>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [remaining, setRemaining] = useState(0);
  const orderKey = useRef("");
  const quoteHeading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (!user) return;
    const controller = new AbortController();
    setProfileError("");
    action<Profile>("get_account", {}, controller.signal).then((value) => {
      setProfile(value);
      setAddressId(value.addresses[0]?.id ?? "new");
    }, (reason: unknown) => { if (!controller.signal.aborted) setProfileError(messageOf(reason)); });
    return () => controller.abort();
  }, [user?.id, profileRetry]);

  useEffect(() => {
    if (!quote) return;
    quoteHeading.current?.focus();
    const update = () => setRemaining(Math.max(0, Math.ceil((Date.parse(quote.expiresAt) - Date.now()) / 1000)));
    update();
    const interval = window.setInterval(update, 1000);
    return () => window.clearInterval(interval);
  }, [quote]);

  async function prepare(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const address = addressId === "new" ? { shippingAddress: getAddress(event) } : { addressId };
    setError("");
    setBusy(true);
    try {
      const newQuote = await action<CheckoutQuote>("prepare_checkout", { ...address, shippingMethod: method });
      orderKey.current = Array.from(crypto.getRandomValues(new Uint8Array(24)), (value) => value.toString(16).padStart(2, "0")).join("");
      setRemaining(Math.max(0, Math.ceil((Date.parse(newQuote.expiresAt) - Date.now()) / 1000)));
      setQuote(newQuote);
    } catch (reason) { setError(messageOf(reason)); }
    finally { setBusy(false); }
  }

  async function place() {
    if (!quote || busy) return;
    setError("");
    setBusy(true);
    try {
      const { order } = await action<{ order: Order }>("place_order", { quoteId: quote.quoteId, idempotencyKey: orderKey.current });
      setCart(null);
      void editCart({ operation: "view" }).catch(() => undefined);
      navigate(`/orders/${encodeURIComponent(order.id)}?placed=1`);
      notify("Your order has been placed.");
    } catch (reason) { setError(messageOf(reason)); }
    finally { setBusy(false); }
  }

  if (sessionPending) return <div className="page wrap"><Loading>Loading checkout…</Loading></div>;
  if (!user) return <div className="page wrap"><div className="empty-state"><LockKeyhole size={30} strokeWidth={1.4} /><h1>Sign in to check out</h1><p>Use your Forme account to complete your order.</p>
    <button className="button" type="button" onClick={() => requireUser(() => undefined, "Sign in to continue checkout.")}>Sign in <ArrowRight size={17} /></button></div></div>;
  if (cart && !cart.items.length && !quote) return <div className="page wrap"><Empty title="Your bag is empty" icon={<ShoppingBag size={32} strokeWidth={1.4} />} href="/shop" label="Explore the collection">Add an object to your bag before checking out.</Empty></div>;

  const currentCart = quote?.cart ?? cart;
  return <div className="page wrap checkout-page">
    <button className="editorial-link" type="button" onClick={() => setOverlay("cart")}><ArrowLeft size={17} /> Back to bag</button>
    <h1>Checkout</h1>
    <nav className="checkout-steps" aria-label="Checkout progress"><span className={quote ? "completed" : "current"}>{quote && <Check size={15} />} Delivery</span><ChevronRight size={14} /><span className={quote ? "current" : ""}>Review and pay</span></nav>
    <div className="checkout-grid">
      <div className="checkout-main">
        {profileError ? <ErrorMessage retry={() => setProfileRetry((value) => value + 1)}>{profileError}</ErrorMessage> : !profile ? <Loading>Loading your checkout details…</Loading> : quote ? <div className="checkout-review">
          <h2 tabIndex={-1} ref={quoteHeading}>Review and pay</h2>
          <div className="summary-block"><div className="section-heading"><h3>Shipping address</h3><button type="button" className="text-button" onClick={() => { setQuote(undefined); setError(""); }} disabled={busy}>Edit delivery</button></div><AddressText address={quote.shippingAddress} />
            <p className="muted inline-icon"><Truck size={17} /> {quote.shippingMethod === "express" ? "Express" : "Standard"} shipping</p></div>
          <div className="summary-block"><h3>Payment</h3><div className="payment-panel"><Wallet size={23} strokeWidth={1.55} /><div><strong>Forme balance</strong><span>{dollars(quote.balance)} available</span></div>{quote.canPlaceOrder && <Check size={18} />}</div>
            {quote.canPlaceOrder ? <p className="muted">Balance after this order: {dollars(quote.balance - quote.cart.total)}</p> : <ErrorMessage>This order cannot be placed with the current balance or stock. Please review your bag.</ErrorMessage>}</div>
          {remaining === 0 && <ErrorMessage>This quote expired. Edit the delivery details to request a new quote.</ErrorMessage>}
          <ErrorMessage>{error}</ErrorMessage>
          <button className="button" type="button" disabled={!quote.canPlaceOrder || busy || remaining === 0} onClick={() => void place()}>{busy ? "Placing order…" : `Place order · ${dollars(quote.cart.total)}`} <ArrowRight size={18} /></button>
        </div> : <form className="form-stack" onSubmit={prepare}>
          <h2>Delivery details</h2>
          {profile.addresses.length > 0 && <fieldset className="choice-list"><legend>Shipping address</legend>
            {profile.addresses.map((address) => <label className="choice" key={address.id}>
              <input type="radio" name="chosen-address" value={address.id} checked={addressId === address.id} onChange={() => setAddressId(address.id)} /><span><strong>{address.label}</strong><small>{address.name} · {address.line1}, {address.city}</small></span>
            </label>)}
            <label className="choice"><input type="radio" name="chosen-address" checked={addressId === "new"} onChange={() => setAddressId("new")} /><span><strong>Use a new address</strong></span></label>
          </fieldset>}
          {addressId === "new" && <AddressFields initial={{ name: profile.name, country: "United States" }} prefix="checkout" />}
          <fieldset className="choice-list"><legend>Shipping method</legend>
            <label className="choice"><input type="radio" name="method" checked={method === "standard"} onChange={() => setMethod("standard")} /><span><strong>Standard shipping</strong><small>Free on orders of $100 or more after discounts</small></span><strong className="choice-price">{cart && cart.shipping === 0 ? "Free" : "$8.95"}</strong></label>
            <label className="choice"><input type="radio" name="method" checked={method === "express"} onChange={() => setMethod("express")} /><span><strong>Express shipping</strong><small>Priority fulfillment</small></span><strong className="choice-price">$16.95</strong></label>
          </fieldset>
          <ErrorMessage>{error}</ErrorMessage>
          <button type="submit" className="button" disabled={busy || !cart?.items.length}>{busy ? "Preparing your order…" : "Review order"} <ArrowRight size={18} /></button>
        </form>}
      </div>
      <aside className="order-summary" aria-label="Order summary"><h2>Order summary</h2>
        {currentCart ? <><LineItems items={currentCart.items} />{!quote && <CouponForm cart={currentCart} />}<Totals {...currentCart} />
          {profile && !quote && <p className="order-balance"><Wallet size={17} /> <span>{dollars(profile.balance)} Forme balance</span></p>}</>
          : <Loading>Loading bag…</Loading>}
      </aside>
    </div>
  </div>;
}

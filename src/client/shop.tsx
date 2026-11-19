import { useEffect, useState, type FormEvent } from "react";
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUpRight, Check, ChevronDown, GitCompareArrows, Heart, PackageCheck, Plus, RotateCcw, Search, SlidersHorizontal, Star, Truck, X } from "lucide-react";
import type { Product, Review } from "../shared/commerce";
import { action, date, dollars, messageOf, request } from "./api";
import { Link, useShop } from "./context";
import { Empty, ErrorMessage, Loading, Modal, ProductImage, Quantity } from "./ui";

export const categories = ["Home", "Desk", "Travel", "Audio"] as const;
export const categoryHref = (category: string) => `/shop?category=${encodeURIComponent(category)}`;
export const productHref = (product: Product) => `/product/${encodeURIComponent(product.id)}`;
type Catalog = { products: Product[]; total: number; categories: string[] };

export function Home() {
  return <>
    <section className="hero wrap" aria-labelledby="hero-title">
      <div className="hero-copy">
        <div className="kicker hero-kicker"><span />The everyday collection</div>
        <h1 id="hero-title">Good design.<br /><em>Every day.</em></h1>
        <p>Thoughtfully chosen objects for the way you live, work, and move.</p>
        <Link className="button hero-button" href="/#catalog">Explore the collection <ArrowRight size={17} strokeWidth={1.6} /></Link>
      </div>
      <div className="hero-image">
        <img src="/images/arc-task-lamp.webp" alt="Arc Task Lamp with an articulated black metal arm on a stone plinth" fetchPriority="high" />
        <Link className="hero-caption" href="/product/arc-task-lamp">
          <span><small>IN THE STUDIO</small><span>Arc Task Lamp</span></span><ArrowUpRight size={20} strokeWidth={1.45} />
        </Link>
      </div>
    </section>
    <CatalogSection home />
    <section className="service-strip wrap" aria-label="Shopping with Forme">
      <Link href="/policies/shipping"><Truck size={23} strokeWidth={1.35} /><span><strong>Free standard shipping</strong><small>On orders of $100 or more</small></span><ArrowUpRight size={15} /></Link>
      <Link href="/policies/returns"><RotateCcw size={22} strokeWidth={1.35} /><span><strong>30-day returns</strong><small>From the date of delivery</small></span><ArrowUpRight size={15} /></Link>
      <Link href="/support"><PackageCheck size={22} strokeWidth={1.35} /><span><strong>Order support</strong><small>Get help with a Forme order</small></span><ArrowUpRight size={15} /></Link>
    </section>
  </>;
}

export function ProductCard({ product }: { product: Product }) {
  const { wishlist, saveProduct, requireUser, editCart, setOverlay, notify } = useShop();
  const [adding, setAdding] = useState(false);
  const saved = wishlist.some((item) => item.id === product.id);
  function quickAdd() {
    if (adding) return;
    requireUser(async () => {
      setAdding(true);
      try {
        await editCart({ operation: "add", items: [{ productId: product.id, color: product.colors[0], quantity: 1 }] });
        setOverlay("cart");
        notify(`${product.name} added to your bag.`);
      } catch (error) { notify(messageOf(error), "error"); }
      finally { setAdding(false); }
    }, "Sign in to add this item to your bag.");
  }
  return <article className="product-card">
    <div className="product-image">
      <Link href={productHref(product)} label={`View ${product.name}`}><ProductImage src={product.images[0]} alt={product.name} /></Link>
      {(product.badge || product.stock === 0) && <span className="product-badge">{product.stock === 0 ? "Sold out" : product.badge}</span>}
      <button type="button" className={`save-button icon-button ${saved ? "saved" : ""}`} aria-label={`${saved ? "Remove" : "Save"} ${product.name} ${saved ? "from" : "to"} wishlist`} aria-pressed={saved} onClick={() => saveProduct(product)}>
        <Heart size={17} strokeWidth={1.5} fill={saved ? "currentColor" : "none"} />
      </button>
    </div>
    <div className="product-card-meta">
      <div><p className="product-category">{product.category}</p><h3><Link href={productHref(product)}>{product.name}</Link></h3>
        <div className="price">{dollars(product.price)} {product.compareAtPrice && <del>{dollars(product.compareAtPrice)}</del>}</div></div>
      {product.stock > 0 && <button type="button" className="quick-add icon-button" onClick={quickAdd} aria-label={`Add ${product.name} to bag`} title={`Add ${product.colors[0] ?? product.name} to bag`} disabled={adding}><Plus size={19} strokeWidth={1.45} /></button>}
    </div>
  </article>;
}

export function CatalogSection({ home = false }: { home?: boolean }) {
  const { href } = useShop();
  const params = new URL(href, window.location.origin).searchParams;
  const query = home ? "" : params.get("q") ?? "";
  const category = home ? "" : params.get("category") ?? "";
  const [sort, setSort] = useState("recommended");
  const [result, setResult] = useState<Catalog>();
  const [pending, setPending] = useState(true);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const [page, setPage] = useState(1);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [inStock, setInStock] = useState(false);
  const [maxPrice, setMaxPrice] = useState<number>();
  const filterKey = JSON.stringify([query, category, sort, inStock, maxPrice, home]);
  const [appliedFilterKey, setAppliedFilterKey] = useState(filterKey);
  const activePage = appliedFilterKey === filterKey ? page : 1;

  useEffect(() => {
    const controller = new AbortController();
    setPending(true);
    setError("");
    if (appliedFilterKey !== filterKey) {
      setAppliedFilterKey(filterKey);
      setPage(1);
    }
    action<Catalog>("discover_products", {
      query: query || undefined, category: category || undefined, sort, inStock: inStock || undefined,
      maxPrice, limit: home ? 8 : Math.min(activePage * 12, 50),
    }, controller.signal).then(setResult, (reason: unknown) => {
      if (!controller.signal.aborted) setError(messageOf(reason));
    }).finally(() => { if (!controller.signal.aborted) setPending(false); });
    return () => controller.abort();
  }, [query, category, sort, inStock, maxPrice, home, activePage, retry, appliedFilterKey, filterKey]);

  const tabs = result?.categories.length ? result.categories : categories;
  const allHref = query ? `/shop?q=${encodeURIComponent(query)}` : home ? "/#catalog" : "/shop";
  const tabHref = (tab: string) => query ? `${categoryHref(tab)}&q=${encodeURIComponent(query)}` : categoryHref(tab);
  const heading = query ? `Results for “${query}”` : category ? `${category} collection` : "The everyday edit.";
  const Heading = home ? "h2" : "h1";

  return <section id="catalog" className={`wrap catalog ${home ? "catalog-home" : "catalog-page"}`} aria-labelledby="catalog-heading">
    <div className="catalog-heading">
      <div>{home && <div className="kicker"><span className="rule" /> Shop the collection</div>}<Heading id="catalog-heading">{heading}</Heading></div>
      {home ? <Link className="editorial-link" href="/shop">View all objects <ArrowUpRight size={18} strokeWidth={1.55} /></Link>
        : <Link className="editorial-link" href="/"><ArrowLeft size={17} /> Back to FORME</Link>}
    </div>
    <div className="catalog-toolbar">
      <nav aria-label="Product categories" className="catalog-tabs">
        <Link href={allHref} active={!category} className={!category ? "active" : ""}>All objects</Link>
        {tabs.map((tab) => <Link key={tab} href={tabHref(tab)} active={category.toLowerCase() === tab.toLowerCase()} className={category.toLowerCase() === tab.toLowerCase() ? "active" : ""}>{tab}</Link>)}
      </nav>
      <div className="catalog-controls">
        {!home && <button type="button" className={`filter-button ${filtersOpen ? "active" : ""}`} onClick={() => setFiltersOpen((open) => !open)} aria-expanded={filtersOpen} aria-controls="catalog-filters"><SlidersHorizontal size={16} /> Filters{(inStock || maxPrice) && <span className="filter-dot" />}</button>}
        <label className="sort-select"><span className="sr-only">Sort products</span>
          <select value={sort} onChange={(event) => setSort(event.target.value)}>
            <option value="recommended">Recommended</option><option value="price_asc">Price: low to high</option><option value="price_desc">Price: high to low</option><option value="rating">Highest rated</option>
          </select><ChevronDown size={14} aria-hidden="true" />
        </label>
      </div>
    </div>
    {filtersOpen && <div className="filter-panel" id="catalog-filters">
      <label className="check-field"><input type="checkbox" checked={inStock} onChange={(event) => setInStock(event.target.checked)} /> In stock only</label>
      <label>Maximum price <select value={maxPrice ?? ""} onChange={(event) => setMaxPrice(event.target.value ? Number(event.target.value) : undefined)}>
        <option value="">Any price</option><option value={5000}>$50</option><option value={10000}>$100</option><option value={20000}>$200</option>
      </select></label>
      {(inStock || maxPrice) && <button type="button" className="text-button" onClick={() => { setInStock(false); setMaxPrice(undefined); }}>Reset filters</button>}
    </div>}
    {!home && !pending && result && <p className="item-count" aria-live="polite">{result.total} {result.total === 1 ? "object" : "objects"}</p>}
    {error ? <ErrorMessage retry={() => setRetry((count) => count + 1)}>{error}</ErrorMessage> : pending && !result ? <Loading>Finding objects…</Loading>
      : <div aria-busy={pending}>
        {result && result.products.length > 0 ? <div className="product-grid">{result.products.map((product) => <ProductCard key={product.id} product={product} />)}</div>
          : !pending && <Empty title="No objects found" icon={<Search size={28} strokeWidth={1.4} />} href="/shop" label="Browse all objects">Try a different search or filter.</Empty>}
        {!home && result && result.products.length < result.total && <div className="load-more"><button className="button secondary" disabled={pending} onClick={() => setPage(activePage + 1)} type="button">{pending ? "Loading…" : "Show more objects"} <ArrowDown size={17} /></button></div>}
      </div>}
  </section>;
}

const shades: Record<string, string> = { black: "#292824", charcoal: "#373531", ink: "#222124", graphite: "#414443", stone: "#ac9f8b", ivory: "#e5d9c8", natural: "#cfbaa0", sand: "#bc9e75", oatmeal: "#c8b49d", olive: "#71705a", brown: "#754b31", tan: "#ae794d", forest: "#4e5b48", navy: "#343e4b", chalk: "#ebe5da", walnut: "#75513b", cream: "#ebdfcd", white: "#f7f5eb", terracotta: "#af614c", sage: "#9b9d84" };
const shade = (name: string) => shades[name.toLowerCase()] ?? name.toLowerCase().split(" ").map((part) => shades[part]).find(Boolean) ?? "#a89b89";

export function Stars({ rating, withText = true }: { rating: number; withText?: boolean }) {
  return <span className="stars" aria-label={`${rating} out of 5 stars`}>
    {[1, 2, 3, 4, 5].map((value) => <Star key={value} size={13} strokeWidth={1.45} fill={value <= Math.round(rating) ? "currentColor" : "none"} aria-hidden="true" />)}
    {withText && <span className="stars-number" aria-hidden="true">{rating.toFixed(1)}</span>}
  </span>;
}

export function ProductPage({ id }: { id: string }) {
  const [product, setProduct] = useState<Product>();
  const [pending, setPending] = useState(true);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setPending(true);
    setError("");
    request<{ products: Product[] }>(`/api/products/${encodeURIComponent(id)}`, { signal: controller.signal }).then(({ products }) => {
      setProduct(products[0]);
    }, (reason: unknown) => { if (!controller.signal.aborted) setError(messageOf(reason)); })
      .finally(() => { if (!controller.signal.aborted) setPending(false); });
    return () => controller.abort();
  }, [id, retry]);
  return <div className="wrap page product-page">
    <nav aria-label="Breadcrumb" className="breadcrumb"><Link href="/shop">Shop</Link>{product && <><span>/</span><Link href={categoryHref(product.category)}>{product.category}</Link><span>/</span><span>{product.name}</span></>}</nav>
    {pending ? <Loading>Loading object…</Loading> : error ? <ErrorMessage retry={() => setRetry((count) => count + 1)}>{error}</ErrorMessage>
      : product ? <ProductDetail key={product.id} product={product} /> : <Empty title="Object not found" href="/shop" label="Browse all objects" />}
  </div>;
}

function ProductDetail({ product }: { product: Product }) {
  const { wishlist, saveProduct, requireUser, editCart, setOverlay, notify, compare, toggleCompare } = useShop();
  const [image, setImage] = useState(0);
  const [color, setColor] = useState(product.colors[0] ?? "");
  const [quantity, setQuantity] = useState(1);
  const [busy, setBusy] = useState(false);
  const saved = wishlist.some((item) => item.id === product.id);
  const comparing = compare.some((item) => item.id === product.id);
  function add() {
    requireUser(async () => {
      setBusy(true);
      try {
        await editCart({ operation: "add", items: [{ productId: product.id, color, quantity }] });
        notify(`${product.name} added to your bag.`);
        setOverlay("cart");
      } catch (error) { notify(messageOf(error), "error"); }
      finally { setBusy(false); }
    }, "Sign in to add this item to your bag.");
  }
  return <>
    <div className="product-detail">
      <div className="gallery">
        <div className="gallery-main"><ProductImage key={product.images[image]} src={product.images[image]} alt={product.name} eager /></div>
        {product.images.length > 1 && <div className="thumbnails">{product.images.map((src, index) => <button key={src} type="button" onClick={() => setImage(index)} className={image === index ? "active" : ""} aria-label={`Show view ${index + 1} of ${product.name}`} aria-pressed={image === index}><ProductImage src={src} alt="" /></button>)}</div>}
      </div>
      <div className="detail-copy">
        <div className="kicker"><span className="rule" />{product.category}</div>
        <h1>{product.name}</h1>
        <div className="detail-price">{dollars(product.price)} {product.compareAtPrice && <del>{dollars(product.compareAtPrice)}</del>}</div>
        {product.reviewCount > 0 && <a href="#reviews" className="review-jump"><Stars rating={product.rating} /> {product.reviewCount} {product.reviewCount === 1 ? "review" : "reviews"}</a>}
        <p className="detail-description">{product.description}</p>
        {product.colors.length > 0 && <div className="color-choice">
          <p>Color <strong>{color}</strong></p>
          <div role="group" aria-label="Product color">{product.colors.map((option) => <button className={color === option ? "active" : ""} type="button" key={option} onClick={() => setColor(option)} aria-pressed={color === option} aria-label={option} title={option}><span style={{ backgroundColor: shade(option) }} /></button>)}</div>
        </div>}
        <p className={`stock ${product.stock === 0 ? "out-of-stock" : ""}`}><span />{product.stock ? product.stock <= 5 ? `Only ${product.stock} left` : "In stock" : "Sold out"}</p>
        <div className="add-row">
          {product.stock > 0 && <Quantity value={quantity} max={product.stock} onChange={setQuantity} disabled={busy} />}
          <button className="button" type="button" disabled={busy || !product.stock} onClick={add}>{busy ? "Adding…" : product.stock ? "Add to bag" : "Sold out"} <ArrowRight size={18} /></button>
          <button className={`wishlist-detail icon-button ${saved ? "saved" : ""}`} type="button" onClick={() => saveProduct(product)} aria-label={saved ? "Remove from wishlist" : "Save to wishlist"} aria-pressed={saved}><Heart size={20} fill={saved ? "currentColor" : "none"} strokeWidth={1.5} /></button>
        </div>
        <button className="text-button compare-button" type="button" aria-pressed={comparing} onClick={() => toggleCompare(product)}>{comparing ? <Check size={17} /> : <GitCompareArrows size={17} />} {comparing ? "Added to comparison" : "Add to comparison"}</button>
        <div className="detail-disclosures">
          <details open><summary>Details<ChevronDown size={16} /></summary><ul>{product.features.map((feature) => <li key={feature}>{feature}</li>)}</ul></details>
          <details><summary>Specifications<ChevronDown size={16} /></summary><dl className="specs">{Object.entries(product.specs).map(([name, value]) => <div key={name}><dt>{name}</dt><dd>{value}</dd></div>)}</dl></details>
          <details><summary>Delivery and returns<ChevronDown size={16} /></summary><p>Standard shipping is free on orders of $100 or more. You can return delivered items within 30 days.</p><Link href="/policies/shipping">Shipping</Link><Link href="/policies/returns">Returns</Link></details>
        </div>
      </div>
    </div>
    <Reviews product={product} />
  </>;
}

function Reviews({ product }: { product: Product }) {
  const { requireUser, notify } = useShop();
  const [reviews, setReviews] = useState<Review[]>();
  const [reviewOffset, setReviewOffset] = useState(0);
  const [moreReviews, setMoreReviews] = useState(false);
  const [readingError, setReadingError] = useState("");
  const [retry, setRetry] = useState(0);
  const [open, setOpen] = useState(false);
  const [rating, setRating] = useState(5);
  const [sending, setSending] = useState(false);
  const [formError, setFormError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    setReadingError("");
    action<{ reviews: Review[]; hasMore: boolean }>("manage_review", { operation: "list", productId: product.id, limit: 6, offset: reviewOffset }, controller.signal)
      .then((value) => { setReviews(value.reviews); setMoreReviews(value.hasMore); }, (error: unknown) => { if (!controller.signal.aborted) setReadingError(messageOf(error)); });
    return () => controller.abort();
  }, [product.id, retry, reviewOffset]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    setFormError("");
    setSending(true);
    try {
      await action("manage_review", { operation: "submit", productId: product.id, rating, title: fields.get("title"), body: fields.get("body") });
      setReviewOffset(0);
      setRetry((count) => count + 1);
      setOpen(false);
      notify("Your review has been saved.");
    } catch (error) { setFormError(messageOf(error)); }
    finally { setSending(false); }
  }

  return <section className="reviews" id="reviews" aria-labelledby="reviews-title">
    <div className="section-heading"><div><h2 id="reviews-title">Customer reviews</h2>
      {product.reviewCount > 0 && <p><Stars rating={product.rating} /> <span>Based on {product.reviewCount} {product.reviewCount === 1 ? "review" : "reviews"}</span></p>}</div>
      <button type="button" className="button secondary" onClick={() => requireUser(() => { setOpen(true); setFormError(""); }, "Sign in to review an object you’ve received.")}>Write a review <ArrowUpRight size={17} /></button></div>
    {readingError ? <ErrorMessage retry={() => setRetry((count) => count + 1)}>{readingError}</ErrorMessage> : !reviews ? <Loading>Loading reviews…</Loading> : reviews.length ? <div className="review-grid">{reviews.map((review) => <article key={review.id} className="review-card"><Stars rating={review.rating} withText={false} /><h3>{review.title}</h3><p>{review.body}</p><small>{review.name} · {date(review.createdAt)}</small></article>)}</div> : <p className="muted">There are no written reviews for this object yet.</p>}
    {(reviewOffset > 0 || moreReviews) && <div className="pagination"><button className="text-button" disabled={reviewOffset === 0} onClick={() => setReviewOffset(Math.max(0, reviewOffset - 6))}>Previous reviews</button><button className="text-button" disabled={!moreReviews} onClick={() => setReviewOffset(reviewOffset + 6)}>More reviews</button></div>}
    {open && <Modal title="Write a review" onClose={() => setOpen(false)}>
      <p className="muted">{product.name}</p>
      <form className="form-stack" onSubmit={submit}>
        <fieldset className="rating-picker"><legend>Rating</legend>{[1, 2, 3, 4, 5].map((value) => <label key={value} title={`${value} stars`}><input className="sr-only" type="radio" name="rating" value={value} checked={rating === value} onChange={() => setRating(value)} aria-label={`${value} stars`} /><Star size={26} strokeWidth={1.5} fill={value <= rating ? "currentColor" : "none"} /></label>)}</fieldset>
        <label className="field"><span>Title</span><input name="title" maxLength={100} required /></label>
        <label className="field"><span>Your review</span><textarea name="body" maxLength={1200} rows={5} required /></label>
        <ErrorMessage>{formError}</ErrorMessage>
        <button className="button" type="submit" disabled={sending}>{sending ? "Saving…" : "Submit review"} <ArrowRight size={17} /></button>
      </form>
    </Modal>}
  </section>;
}

export function SearchOverlay({ onClose }: { onClose: () => void }) {
  const { navigate } = useShop();
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState<Catalog>();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const value = query.trim();
    setMatches(undefined);
    setError("");
    if (!value) { setLoading(false); return; }
    const controller = new AbortController();
    setLoading(true);
    const timer = window.setTimeout(() => {
      action<Catalog>("discover_products", { query: value, limit: 5 }, controller.signal)
        .then(setMatches, (reason: unknown) => { if (!controller.signal.aborted) setError(messageOf(reason)); })
        .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    }, 180);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [query]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    navigate(query.trim() ? `/shop?q=${encodeURIComponent(query.trim())}` : "/shop");
  }

  return <Modal title="Search FORME" onClose={onClose}>
    <form className="search-input" role="search" onSubmit={submit}>
      <Search size={21} strokeWidth={1.5} aria-hidden="true" /><input type="search" aria-label="Search objects" placeholder="Search for an object…" value={query} onChange={(event) => setQuery(event.target.value)} data-autofocus autoComplete="off" />
      <button className="icon-button" type="submit" aria-label="Show search results"><ArrowRight size={21} /></button>
    </form>
    {!query.trim() && <div className="search-categories"><p className="kicker">Browse by collection</p>{categories.map((category) => <Link key={category} href={categoryHref(category)}>{category} <ArrowUpRight size={14} /></Link>)}</div>}
    {loading ? <Loading>Searching…</Loading> : error ? <ErrorMessage>{error}</ErrorMessage> : matches && (matches.total ? <>
      <ul className="search-results">{matches.products.map((product) => <li key={product.id}><Link href={productHref(product)}><ProductImage src={product.images[0]} alt="" /><span><small>{product.category}</small><strong>{product.name}</strong></span><span>{dollars(product.price)}</span></Link></li>)}</ul>
      <Link className="editorial-link" href={`/shop?q=${encodeURIComponent(query.trim())}`}>View all {matches.total} {matches.total === 1 ? "result" : "results"} <ArrowRight size={17} /></Link>
    </> : <p className="muted">No objects match “{query.trim()}”.</p>)}
  </Modal>;
}

export function CompareOverlay({ onClose }: { onClose: () => void }) {
  const { compare, toggleCompare } = useShop();
  const [items, setItems] = useState(compare);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!compare.length) { setItems([]); return; }
    const controller = new AbortController();
    setError("");
    action<{ products: Product[] }>("inspect_products", { productIds: compare.map((product) => product.id) }, controller.signal)
      .then(({ products }) => setItems(products), (reason: unknown) => {
        if (!controller.signal.aborted) { setItems(compare); setError(messageOf(reason)); }
      });
    return () => controller.abort();
  }, [compare]);
  const specs = [...new Set(items.flatMap((item) => Object.keys(item.specs)))];
  return <Modal wide title="Compare objects" onClose={onClose}>
    <ErrorMessage>{error}</ErrorMessage>
    {!items.length ? <Empty title="Nothing to compare" href="/shop" label="Browse objects" />
      : <div className="compare-table"><table>
        <thead><tr><th scope="col"><span className="sr-only">Object</span></th>{items.map((product) => <th key={product.id} scope="col">
          <div className="compare-photo"><ProductImage src={product.images[0]} alt="" /><button type="button" className="icon-button" aria-label={`Remove ${product.name} from comparison`} onClick={() => toggleCompare(product)}><X size={16} /></button></div>
          <Link href={productHref(product)}>{product.name}</Link></th>)}</tr></thead>
        <tbody>
          <tr><th scope="row">Price</th>{items.map((item) => <td key={item.id}>{dollars(item.price)}</td>)}</tr>
          <tr><th scope="row">Rating</th>{items.map((item) => <td key={item.id}>{item.reviewCount ? <Stars rating={item.rating} /> : "No ratings"}</td>)}</tr>
          <tr><th scope="row">Colors</th>{items.map((item) => <td key={item.id}>{item.colors.join(", ") || "—"}</td>)}</tr>
          <tr><th scope="row">Features</th>{items.map((item) => <td key={item.id}>{item.features.join(" · ")}</td>)}</tr>
          {specs.map((spec) => <tr key={spec}><th scope="row">{spec}</th>{items.map((item) => <td key={item.id}>{item.specs[spec] ?? "—"}</td>)}</tr>)}
        </tbody>
      </table></div>}
  </Modal>;
}

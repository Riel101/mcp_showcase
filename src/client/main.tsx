import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ArrowRight, ArrowUpRight, Check, GitCompareArrows, Heart, Menu, Search, ShoppingBag, Sparkles, UserRound, X } from 'lucide-react';
import type { Cart, Product } from '../shared/commerce';
import { action, messageOf, post, request } from './api';
import { Link, ShopContext, type CartChange, type Overlay, type User } from './context';
import { CatalogSection, CompareOverlay, Home, ProductPage, SearchOverlay, categories, categoryHref } from './shop';
import { AuthOverlay, CartOverlay, Checkout } from './checkout';
import { Account, Connect, Orders, Policies, Support, Wishlist } from './pages';
import { Empty, Modal } from './ui';
import './styles.css';

function App() {
  const [href, setHref] = useState(location.pathname + location.search + location.hash);
  const [user, setUser] = useState<User | null>(null);
  const [sessionPending, setSessionPending] = useState(true);
  const [cart, setCart] = useState<Cart | null>(null);
  const [wishlist, setWishlist] = useState<Product[]>([]);
  const [compare, setCompare] = useState<Product[]>([]);
  const [overlay, setOverlay] = useState<Overlay>(null);
  const [purpose, setPurpose] = useState('');
  const [toast, setToast] = useState<{ text: string; variant: 'success' | 'error' }>();
  const pendingAction = useRef<(() => void | Promise<void>) | null>(null);
  const mounted = useRef(true);
  const notify = (text: string, variant: 'success' | 'error' = 'success') => setToast({ text, variant });
  useEffect(() => { if (!toast) return; const id = setTimeout(() => setToast(undefined), 5000); return () => clearTimeout(id); }, [toast]);
  useEffect(() => {
    mounted.current = true;
    request<{ user: User | null }>('/api/session').then(value => { if (mounted.current) setUser(value.user); }).catch(error => notify(messageOf(error), 'error')).finally(() => { if (mounted.current) setSessionPending(false); });
    const pop = () => { setHref(location.pathname + location.search + location.hash); setOverlay(null); };
    window.addEventListener('popstate', pop);
    return () => { mounted.current = false; window.removeEventListener('popstate', pop); };
  }, []);
  async function refreshShopping() {
    const [basket, saved] = await Promise.all([action<Cart>('manage_cart', { operation: 'view' }), action<{ products: Product[] }>('manage_wishlist', { operation: 'view' })]);
    setCart(basket); setWishlist(saved.products);
  }
  useEffect(() => {
    if (!user) { setCart(null); setWishlist([]); return; }
    void refreshShopping().catch(error => notify(messageOf(error), 'error'));
    const focus = () => { void refreshShopping().catch(() => undefined); };
    window.addEventListener('focus', focus);
    return () => window.removeEventListener('focus', focus);
  }, [user?.id]);
  function navigate(next: string) {
    history.pushState(null, '', next); setHref(next); setOverlay(null);
    const hash = new URL(next, location.origin).hash;
    requestAnimationFrame(() => hash ? document.getElementById(hash.slice(1))?.scrollIntoView({ behavior: 'smooth' }) : window.scrollTo({ top: 0 }));
  }
  function requireUser(run: () => void | Promise<void>, explanation = 'Sign in to continue shopping.') {
    if (user) { void Promise.resolve(run()).catch(error => notify(messageOf(error), 'error')); return; }
    pendingAction.current = run; setPurpose(explanation); setOverlay('auth');
  }
  async function editCart(edit: CartChange) { const next = await action<Cart>('manage_cart', edit); setCart(next); return next; }
  function saveProduct(product: Product) {
    requireUser(async () => {
      const saved = wishlist.some(item => item.id === product.id);
      const result = await action<{ products: Product[] }>('manage_wishlist', { operation: saved ? 'remove' : 'add', productIds: [product.id] });
      setWishlist(result.products); notify(saved ? 'Removed from your wishlist.' : 'Saved to your wishlist.');
    }, 'Sign in to save your favorite objects.');
  }
  function toggleCompare(product: Product) {
    if (compare.some(item => item.id === product.id)) setCompare(compare.filter(item => item.id !== product.id));
    else if (compare.length === 4) notify('Compare up to four objects at a time.', 'error');
    else { setCompare([...compare, product]); notify('Added to your comparison.'); }
  }
  async function signOut() { await post('/api/auth/logout'); setUser(null); setOverlay(null); navigate('/'); notify('You’re signed out.'); }
  async function authenticated(value: User) {
    setUser(value); setOverlay(null);
    const run = pendingAction.current; pendingAction.current = null;
    try { await run?.(); await refreshShopping(); } catch (error) { notify(messageOf(error), 'error'); }
  }
  const path = new URL(href, location.origin).pathname;
  let page: React.ReactNode;
  if (path === '/') page = <Home />;
  else if (path === '/shop') page = <CatalogSection />;
  else if (path.startsWith('/product/')) page = <ProductPage id={decodeURIComponent(path.slice(9))} />;
  else if (path === '/checkout') page = <Checkout />;
  else if (path === '/wishlist') page = <Wishlist />;
  else if (path === '/orders' || path.startsWith('/orders/')) page = <Orders id={path.startsWith('/orders/') ? decodeURIComponent(path.slice(8)) : undefined} />;
  else if (path === '/account') page = <Account />;
  else if (path === '/connect') page = <Connect />;
  else if (path === '/support') page = <Support />;
  else if (path.startsWith('/policies/')) page = <Policies topic={path.slice(10)} />;
  else page = <div className="page wrap"><Empty title="This page has moved." href="/shop" label="Explore the collection" /></div>;
  return <ShopContext.Provider value={{ href, navigate, user, sessionPending, cart, setCart, refreshShopping, wishlist, compare, toggleCompare, clearCompare: () => setCompare([]), overlay, setOverlay, requireUser, editCart, saveProduct, notify, signOut, setUser }}>
    <a className="skip-link" href="#main">Skip to content</a>
    <div className="announcement"><span>Considered objects. A little less ordinary.</span><Link href="/policies/shipping">Complimentary shipping over $100 <ArrowUpRight size={12} /></Link></div>
    <header className="site-header wrap">
      <button className="icon-button mobile-menu" aria-label="Open menu" onClick={() => setOverlay('menu')}><Menu size={23} /></button>
      <Link className="wordmark" href="/" label="FORME home">FORME<span>®</span></Link>
      <nav className="main-nav" aria-label="Main navigation"><Link href="/shop" active={path === '/shop'}>All objects</Link>{categories.map(category => <Link key={category} href={categoryHref(category)}>{category}</Link>)}</nav>
      <div className="header-actions"><Link className="agent-link" href="/connect"><Sparkles size={14} /> Shop with your agent</Link><button className="icon-button" aria-label="Search" onClick={() => setOverlay('search')}><Search size={20} strokeWidth={1.5} /></button><Link className="icon-button hide-small" label="Wishlist" href="/wishlist"><Heart size={20} strokeWidth={1.5} /></Link><Link className="icon-button" label="Your account" href="/account"><UserRound size={20} strokeWidth={1.5} /></Link><button className="icon-button bag-button" aria-label={`Shopping bag, ${cart?.itemCount ?? 0} items`} onClick={() => setOverlay('cart')}><ShoppingBag size={20} strokeWidth={1.5} /><span>{cart?.itemCount ?? 0}</span></button></div>
    </header>
    <main id="main">{page}</main>
    {path === '/' && <section className="agent-banner wrap"><div className="agent-mark"><Sparkles size={32} strokeWidth={1} /></div><div><div className="kicker">A new way to shop</div><h2>Your taste. Your agent.</h2><p>Find the right object, place an order, and take care of the details.<br />All through the assistant you already use.</p></div><Link href="/connect" className="button light">Meet your new shopping ritual <ArrowUpRight size={17} /></Link></section>}
    <footer className="site-footer wrap"><div className="footer-top"><div><Link className="wordmark" href="/">FORME<span>®</span></Link><p>Objects for a life well considered.</p></div><div className="footer-links"><div><strong>Explore</strong><Link href="/shop">All objects</Link><Link href="/wishlist">Your wishlist</Link><Link href="/connect">Shop with your agent</Link></div><div><strong>Here to help</strong><Link href="/orders">Your orders</Link><Link href="/policies/shipping">Shipping & delivery</Link><Link href="/policies/returns">Returns</Link><Link href="/support">Contact us</Link></div><div><strong>Your Forme</strong><Link href="/account">Account</Link><Link href="/policies/payments">Payments</Link><Link href="/policies/privacy">Privacy</Link></div></div></div><div className="footer-bottom"><span>© {new Date().getFullYear()} Forme. Thoughtfully selected.</span><span>Made for the everyday.</span></div></footer>
    {compare.length > 0 && <div className="compare-dock"><button onClick={() => setOverlay('compare')}><GitCompareArrows size={17} /> Compare objects <span>{compare.length}</span></button><button className="icon-button" aria-label="Clear comparison" onClick={() => setCompare([])}><X size={16} /></button></div>}
    {toast && <div className={`toast ${toast.variant}`} role={toast.variant === 'error' ? 'alert' : 'status'}>{toast.variant === 'success' && <Check size={16} />}<span>{toast.text}</span><button className="icon-button" aria-label="Dismiss notification" onClick={() => setToast(undefined)}><X size={16} /></button></div>}
    {overlay === 'auth' && <AuthOverlay purpose={purpose} onClose={() => { pendingAction.current = null; setOverlay(null); }} onSuccess={value => void authenticated(value)} />}
    {overlay === 'cart' && <CartOverlay onClose={() => setOverlay(null)} />}
    {overlay === 'search' && <SearchOverlay onClose={() => setOverlay(null)} />}
    {overlay === 'compare' && <CompareOverlay onClose={() => setOverlay(null)} />}
    {overlay === 'menu' && <Modal title="Explore FORME" drawer onClose={() => setOverlay(null)}><nav className="mobile-nav"><Link href="/shop">All objects <ArrowRight size={18} /></Link>{categories.map(category => <Link href={categoryHref(category)} key={category}>{category}</Link>)}<Link href="/wishlist">Wishlist</Link><Link href="/orders">Orders</Link><Link href="/connect">Shop with your agent</Link></nav></Modal>}
  </ShopContext.Provider>;
}
createRoot(document.getElementById('root')!).render(<App />);

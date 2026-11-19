import { useEffect, useId, useRef, type FormEvent, type ReactNode } from "react";
import { ArrowRight, CircleAlert, LoaderCircle, Minus, Plus, X } from "lucide-react";
import type { AddressInput, Cart, Order } from "../shared/commerce";
import { dollars } from "./api";
import { Link } from "./context";

export function Modal({ title, children, onClose, drawer = false, wide = false, footer }: {
  title: string; children: ReactNode; onClose: () => void; drawer?: boolean; wide?: boolean; footer?: ReactNode;
}) {
  const id = useId();
  const box = useRef<HTMLDialogElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const dialog = box.current;
    const previous = document.activeElement as HTMLElement | null;
    const originalOverflow = document.body.style.overflow;
    if (dialog && !dialog.open) dialog.showModal();
    dialog?.querySelector<HTMLElement>("[data-autofocus]")?.focus();
    document.body.style.overflow = "hidden";
    return () => {
      dialog?.close();
      document.body.style.overflow = originalOverflow;
      if (previous?.isConnected) previous.focus();
    };
  }, []);
  return <dialog ref={box} className={`modal ${drawer ? "modal-drawer" : ""} ${wide ? "modal-wide" : ""}`} aria-labelledby={id}
    onCancel={(event) => { event.preventDefault(); closeRef.current(); }}
    onClick={(event) => { if (event.target === event.currentTarget) closeRef.current(); }}>
    <div className="modal-inner">
      <header className="modal-header">
        <h2 id={id}>{title}</h2>
        <button type="button" className="icon-button" onClick={onClose} aria-label="Close"><X size={23} strokeWidth={1.5} /></button>
      </header>
      <div className="modal-content">{children}</div>
      {footer && <div className="modal-footer">{footer}</div>}
    </div>
  </dialog>;
}

export function Loading({ children = "Loading…" }: { children?: ReactNode }) {
  return <p className="loading" role="status"><LoaderCircle aria-hidden="true" size={19} /> {children}</p>;
}

export function ErrorMessage({ children, retry }: { children?: ReactNode; retry?: () => void }) {
  if (!children) return null;
  return <div className="error-message" role="alert"><CircleAlert size={17} aria-hidden="true" /><span>{children}</span>{retry && <button type="button" className="text-button" onClick={retry}>Try again</button>}</div>;
}

export function Empty({ title, children, href, label, icon }: { title: string; children?: ReactNode; href?: string; label?: string; icon?: ReactNode }) {
  return <div className="empty-state">{icon}<h2>{title}</h2>{children && <p>{children}</p>}
    {href && label && <Link className="button" href={href}>{label}<ArrowRight size={17} /></Link>}</div>;
}

export function ProductImage({ src, alt, eager = false }: { src?: string; alt: string; eager?: boolean }) {
  return <img src={src || "/images/forme-studio.webp"} alt={alt} loading={eager ? "eager" : "lazy"} decoding="async"
    onError={(event) => {
      const image = event.currentTarget;
      if (!image.dataset.fallback) {
        image.dataset.fallback = "true";
        image.src = "/images/forme-studio.webp";
      }
    }} />;
}

export function Quantity({ value, onChange, max = 99, disabled = false, label = "Quantity" }: {
  value: number; onChange: (qty: number) => void; max?: number; disabled?: boolean; label?: string;
}) {
  return <div className="quantity" role="group" aria-label={label}>
    <button type="button" aria-label={`Decrease ${label.toLowerCase()}`} disabled={disabled || value <= 1} onClick={() => onChange(value - 1)}><Minus size={14} /></button>
    <span aria-live="polite">{value}</span>
    <button type="button" aria-label={`Increase ${label.toLowerCase()}`} disabled={disabled || value >= max} onClick={() => onChange(value + 1)}><Plus size={14} /></button>
  </div>;
}

export function Totals({ total, subtotal, discount, shipping }: Pick<Cart | Order, "total" | "subtotal" | "discount" | "shipping">) {
  return <dl className="totals">
    <div><dt>Subtotal</dt><dd>{dollars(subtotal)}</dd></div>
    {discount > 0 && <div className="discount"><dt>Discount</dt><dd>−{dollars(discount)}</dd></div>}
    <div><dt>Shipping</dt><dd>{shipping ? dollars(shipping) : "Free"}</dd></div>
    <div className="total"><dt>Total</dt><dd>{dollars(total)}</dd></div>
  </dl>;
}

export function AddressFields({ initial, includeLabel = false, prefix = "address" }: { initial?: Partial<AddressInput>; includeLabel?: boolean; prefix?: string }) {
  const input = (name: keyof AddressInput, label: string, autoComplete: string, required = true) => <label className="field" key={name} htmlFor={`${prefix}-${name}`}>
    <span>{label}</span>
    <input id={`${prefix}-${name}`} name={name} defaultValue={initial?.[name]} required={required} autoComplete={autoComplete} maxLength={120} />
  </label>;
  return <div className="address-fields">
    {includeLabel && input("label", "Address label", "off")}
    {input("name", "Full name", "shipping name")}
    {input("line1", "Street address", "shipping address-line1")}
    {input("line2", "Apartment, suite, etc. (optional)", "shipping address-line2", false)}
    <div className="field-row">
      {input("city", "City", "shipping address-level2")}
      {input("region", "State / region", "shipping address-level1")}
    </div>
    <div className="field-row">
      {input("postalCode", "Postal code", "shipping postal-code")}
      {input("country", "Country", "shipping country-name")}
    </div>
  </div>;
}

export function getAddress(event: FormEvent<HTMLFormElement>, id?: string): AddressInput {
  const data = new FormData(event.currentTarget);
  const read = (name: string) => String(data.get(name) ?? "").trim();
  return { id, label: read("label") || undefined, name: read("name"), line1: read("line1"), line2: read("line2") || undefined,
    city: read("city"), region: read("region"), postalCode: read("postalCode"), country: read("country") };
}

export function AddressText({ address, showName = true }: { address: AddressInput; showName?: boolean }) {
  return <address>{showName && <>{address.name}<br /></>}{address.line1}<br />
    {address.line2 && <>{address.line2}<br /></>}{address.city}, {address.region} {address.postalCode}<br />{address.country}</address>;
}

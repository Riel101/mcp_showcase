import { createContext, useContext, type MouseEvent, type ReactNode } from "react";
import type { Cart, Product } from "../shared/commerce";

export interface User {
  id: string;
  name: string;
  email: string;
}

export type CartChange = {
  operation: "view" | "add" | "update" | "remove" | "clear" | "apply_coupon" | "remove_coupon";
  items?: { productId: string; color?: string; quantity: number }[];
  coupon?: string;
};

export type Overlay = "search" | "cart" | "auth" | "compare" | "menu" | null;

export interface Shop {
  href: string;
  navigate: (href: string) => void;
  user: User | null;
  sessionPending: boolean;
  cart: Cart | null;
  setCart: (cart: Cart | null) => void;
  refreshShopping: () => Promise<void>;
  wishlist: Product[];
  compare: Product[];
  toggleCompare: (product: Product) => void;
  clearCompare: () => void;
  overlay: Overlay;
  setOverlay: (overlay: Overlay) => void;
  requireUser: (run: () => void | Promise<void>, purpose?: string) => void;
  editCart: (edit: CartChange) => Promise<Cart>;
  saveProduct: (product: Product) => void;
  notify: (message: string, variant?: "success" | "error") => void;
  signOut: () => Promise<void>;
  setUser: (user: User | null) => void;
}
export const ShopContext = createContext<Shop | null>(null);
export const useShop = () => {
  const value = useContext(ShopContext);
  if (!value) throw new Error("Shop context is unavailable.");
  return value;
};

export function Link({ href, children, className, title, label, active, onClick }: {
  href: string;
  children: ReactNode;
  className?: string;
  title?: string;
  label?: string;
  active?: boolean;
  onClick?: () => void;
}) {
  const { navigate } = useShop();
  function visit(event: MouseEvent<HTMLAnchorElement>) {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    onClick?.();
    navigate(href);
  }
  return <a href={href} onClick={visit} className={className} title={title} aria-label={label} aria-current={active ? "page" : undefined}>{children}</a>;
}

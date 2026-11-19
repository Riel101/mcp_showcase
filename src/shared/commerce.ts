export type Currency = "USD";
export type Category = "Home" | "Desk" | "Travel" | "Audio";
export type ShippingMethod = "standard" | "express";
export type PaymentMethod = "store_credit";

export interface Product {
  id: string;
  slug: string;
  name: string;
  category: Category;
  description: string;
  price: number;
  compareAtPrice?: number;
  currency: Currency;
  images: string[];
  colors: string[];
  features: string[];
  specs: Record<string, string>;
  stock: number;
  rating: number;
  reviewCount: number;
  badge?: string;
}

export interface AddressInput {
  id?: string;
  label?: string;
  name: string;
  line1: string;
  line2?: string;
  city: string;
  region: string;
  postalCode: string;
  country: string;
}

export interface Address extends AddressInput {
  id: string;
  label: string;
}

export interface CartItem {
  productId: string;
  name: string;
  image: string;
  color: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
}

export interface Cart {
  items: CartItem[];
  subtotal: number;
  discount: number;
  shipping: number;
  total: number;
  currency: Currency;
  coupon: string | null;
  itemCount: number;
}

export interface CheckoutQuote {
  quoteId: string;
  expiresAt: string;
  cart: Cart;
  shippingAddress: AddressInput;
  shippingMethod: ShippingMethod;
  paymentMethod: PaymentMethod;
  balance: number;
  canPlaceOrder: boolean;
}

export type OrderStatus = "pending" | "processing" | "shipped" | "delivered" | "cancelled" | "partially_returned" | "returned";

export interface OrderEvent {
  status: OrderStatus;
  at: string;
  description: string;
}

export interface Order {
  id: string;
  status: OrderStatus;
  items: CartItem[];
  subtotal: number;
  discount: number;
  shipping: number;
  total: number;
  currency: Currency;
  coupon: string | null;
  shippingAddress: AddressInput;
  shippingMethod: ShippingMethod;
  paymentMethod: PaymentMethod;
  createdAt: string;
  events: OrderEvent[];
  returnedProductIds: string[];
  cancellationReason?: string;
  returns?: ReturnRequest[];
}

export interface Profile {
  id: string;
  email: string;
  name: string;
  balance: number;
  currency: Currency;
  addresses: Address[];
}

export interface Review {
  id: string;
  productId: string;
  name: string;
  rating: number;
  title: string;
  body: string;
  createdAt: string;
  updatedAt: string;
}

export interface ReturnRequest {
  id: string;
  status: "refunded";
  refund: number;
  items: CartItem[];
  createdAt: string;
  instructions: string;
  reason: string;
}

export interface SupportTicket {
  id: string;
  subject: string;
  message: string;
  orderId?: string;
  status: "open";
  createdAt: string;
}

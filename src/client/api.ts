export class ApiError extends Error {
  constructor(message: string, public status: number, public code?: string) {
    super(message);
  }
}

export async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(path, { credentials: "same-origin", ...options });
  if (response.status === 204) return undefined as T;
  const value = await response.json().catch(() => undefined);
  if (!response.ok) {
    const error = value?.error;
    const message = error?.message ?? value?.message ?? (typeof error === "string" ? error : undefined);
    throw new ApiError(message || `Forme could not complete that request (${response.status}).`, response.status, error?.code ?? value?.code);
  }
  if (value === undefined) throw new ApiError("Forme returned an unreadable response.", response.status);
  return value as T;
}

export function post<T>(path: string, body: Record<string, unknown> = {}, signal?: AbortSignal) {
  return request<T>(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal });
}

export function action<T>(name: string, body: Record<string, unknown> = {}, signal?: AbortSignal) {
  return post<T>(`/api/actions/${name}`, body, signal);
}

export const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
export const dollars = (cents: number) => money.format(cents / 100);
export const date = (value: string) => new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(new Date(value));
export const messageOf = (error: unknown) => error instanceof Error ? error.message : "Something went wrong. Please try again.";

import { createServerFn } from "@tanstack/react-start";

export const getPolSpot = createServerFn({ method: "GET" }).handler(async (): Promise<number | null> => {
  try {
    const response = await fetch("https://api.exchange.coinbase.com/products/POL-USD/ticker", {
      signal: AbortSignal.timeout(8000),
      headers: { accept: "application/json" },
    });
    if (!response.ok) return null;
    const body = (await response.json()) as { price?: string };
    const price = Number(body.price);
    if (!Number.isFinite(price) || price <= 0) return null;
    return price;
  } catch {
    return null;
  }
});

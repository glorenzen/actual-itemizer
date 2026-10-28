export interface IncomingOrderPayload {
  retailer: string;
  orderId: string;
  orderDate: string;
  grandTotal: number;
  items: Array<{ name: string; quantity: number; price: number }>;
}

export function isValidPayload(body: unknown): body is IncomingOrderPayload {
  if (typeof body !== "object" || body === null) return false;
  const b = body as Record<string, unknown>;
  return (
    typeof b.retailer === "string" &&
    typeof b.orderId === "string" &&
    typeof b.orderDate === "string" &&
    typeof b.grandTotal === "number" &&
    Array.isArray(b.items) &&
    b.items.length > 0 &&
    b.items.length <= 200 &&
    b.items.every((item) => {
      if (typeof item !== "object" || item === null) return false;
      const i = item as Record<string, unknown>;
      return (
        typeof i.name === "string" &&
        i.name.length <= 500 &&
        typeof i.quantity === "number" &&
        typeof i.price === "number"
      );
    })
  );
}

export function addDays(isoDate: string, days: number): string {
  const date = new Date(isoDate);
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

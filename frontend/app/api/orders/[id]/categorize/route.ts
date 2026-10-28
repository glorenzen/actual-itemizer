import { getAvailableCategories, initActual } from "../../../../lib/actual";
import { isAuthorized, unauthorized } from "../../../../lib/auth";
import { getOrderById, setProposed } from "../../../../lib/db";
import { categorizeOrder } from "../../../../lib/localai";
import type { IncomingOrderPayload } from "../../../../lib/orders";

export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!isAuthorized(request)) return unauthorized();

  const { id } = await params;
  const order = getOrderById(id);
  if (!order) {
    return Response.json({ error: "Order not found" }, { status: 404 });
  }

  await initActual();
  const payload = JSON.parse(order.payload_json) as IncomingOrderPayload;
  const categories = await getAvailableCategories();
  const result = await categorizeOrder({
    retailer: order.retailer,
    items: payload.items.map((i) => ({ name: i.name, quantity: i.quantity, price: i.price })),
    grandTotal: order.grand_total,
    categories,
  });
  setProposed(order.id, JSON.stringify(result));
  return Response.json(result);
}

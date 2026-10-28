import { findUncategorizedCandidates, initActual } from "../../../../lib/actual";
import { isAuthorized, unauthorized } from "../../../../lib/auth";
import { getOrderById } from "../../../../lib/db";
import { addDays } from "../../../../lib/orders";

export const runtime = "nodejs";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!isAuthorized(request)) return unauthorized();

  const { id } = await params;
  const order = getOrderById(id);
  if (!order) {
    return Response.json({ error: "Order not found" }, { status: 404 });
  }

  await initActual();
  const candidates = await findUncategorizedCandidates({
    payeeMatch: order.retailer,
    dateFrom: order.order_date,
    dateTo: addDays(order.order_date, 5),
    targetAmount: order.grand_total,
  });
  return Response.json(candidates);
}

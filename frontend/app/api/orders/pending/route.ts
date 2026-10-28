import { isAuthorized, unauthorized } from "../../../lib/auth";
import { config } from "../../../config";
import { getPendingOrders } from "../../../lib/db";

export const runtime = "nodejs";

export async function GET(request: Request) {
  if (!isAuthorized(request)) return unauthorized();

  const orders = getPendingOrders().map((o) => ({
    payload: JSON.parse(o.payload_json),
    taxRatePercent: config.server.taxRatePercent,
    id: o.id,
    retailer: o.retailer,
    orderId: o.external_order_id,
    orderDate: o.order_date,
    grandTotal: o.grand_total,
    status: o.status,
    proposed: o.proposed_json ? JSON.parse(o.proposed_json) : null,
  }));
  return Response.json(orders);
}

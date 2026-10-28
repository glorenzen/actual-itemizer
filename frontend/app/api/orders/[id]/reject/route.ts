import { isAuthorized, unauthorized } from "../../../../lib/auth";
import { deleteOrder, getOrderById, markRejected } from "../../../../lib/db";

export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!isAuthorized(request)) return unauthorized();

  const { id } = await params;
  const order = getOrderById(id);
  if (!order) {
    return Response.json({ error: "Order not found" }, { status: 404 });
  }

  markRejected(order.id);
  deleteOrder(order.id);
  return new Response(null, { status: 204 });
}

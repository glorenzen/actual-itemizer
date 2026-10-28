import { initActual, orderMarker, writeSplit } from "../../../../lib/actual";
import { isAuthorized, unauthorized } from "../../../../lib/auth";
import { deleteOrder, getOrderById } from "../../../../lib/db";

export const runtime = "nodejs";

interface ApproveLink {
  transactionId: string;
  accountId: string;
  date: string;
  transactionAmount: number;
  allocations: Array<{ categoryId: string; amount: number; notes?: string }>;
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!isAuthorized(request)) return unauthorized();

  const { id } = await params;
  const order = getOrderById(id);
  if (!order) {
    return Response.json({ error: "Order not found" }, { status: 404 });
  }

  const body = await request.json().catch(() => null);
  const links = (body?.links ?? []) as ApproveLink[];
  if (!Array.isArray(links) || links.length === 0) {
    return Response.json({ error: "At least one transaction link is required" }, { status: 400 });
  }

  for (const link of links) {
    const sum = link.allocations.reduce((total, a) => total + a.amount, 0);
    const expectedAmount = Math.abs(link.transactionAmount);
    if (sum !== expectedAmount) {
      return Response.json(
        { error: `Allocations for transaction ${link.transactionId} sum to ${sum}, expected ${expectedAmount}` },
        { status: 400 },
      );
    }
  }

  await initActual();
  for (const link of links) {
    const allocationSign = link.transactionAmount < 0 ? -1 : 1;
    await writeSplit({
      transactionId: link.transactionId,
      accountId: link.accountId,
      date: link.date,
      allocations: link.allocations.map((allocation) => ({
        ...allocation,
        amount: allocation.amount * allocationSign,
      })),
      orderMarker: orderMarker(order.retailer, order.external_order_id),
    });
  }

  deleteOrder(order.id);
  return new Response(null, { status: 204 });
}

import { randomUUID } from "node:crypto";
import { findTransactionNoteMatch, initActual } from "../../lib/actual";
import { isAuthorized, unauthorized } from "../../lib/auth";
import { findByRetailerAndExternalId, insertOrder } from "../../lib/db";
import { addDays, isValidPayload } from "../../lib/orders";

export const runtime = "nodejs";

// The extension popup calls this endpoint cross-origin from a moz-extension://
// origin; mirror the old Express server's permissive CORS for it.
function corsHeaders(request: Request): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": request.headers.get("origin") ?? "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };
}

export async function OPTIONS(request: Request) {
  return new Response(null, { status: 204, headers: corsHeaders(request) });
}

export async function POST(request: Request) {
  if (!isAuthorized(request)) return unauthorized();

  const body = await request.json().catch(() => null);
  if (!isValidPayload(body)) {
    return Response.json({ error: "Invalid order payload" }, { status: 400, headers: corsHeaders(request) });
  }

  const existing = findByRetailerAndExternalId(body.retailer, body.orderId);
  if (existing) {
    return Response.json(
      { error: "Order already pending review", id: existing.id },
      { status: 409, headers: corsHeaders(request) },
    );
  }

  await initActual();
  const alreadyProcessed = await findTransactionNoteMatch(
    body.retailer,
    body.orderId,
    body.orderDate,
    addDays(body.orderDate, 5),
  );
  if (alreadyProcessed) {
    return Response.json(
      { error: "Order already applied to a transaction in Actual" },
      { status: 409, headers: corsHeaders(request) },
    );
  }

  const id = randomUUID();
  insertOrder({
    id,
    retailer: body.retailer,
    externalOrderId: body.orderId,
    orderDate: body.orderDate,
    grandTotal: body.grandTotal,
    payloadJson: JSON.stringify(body),
  });

  return Response.json({ id }, { status: 201, headers: corsHeaders(request) });
}

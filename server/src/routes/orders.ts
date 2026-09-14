import { Router } from "express";
import { randomUUID } from "node:crypto";
import {
  deleteOrder,
  findByRetailerAndExternalId,
  getOrderById,
  getPendingOrders,
  insertOrder,
  markRejected,
  setProposed,
} from "../db.js";
import {
  findTransactionNoteMatch,
  findUncategorizedCandidates,
  getAvailableCategories,
  orderMarker,
  writeSplit,
} from "../actual.js";
import { categorizeOrder } from "../localai.js";

export const ordersRouter = Router();

interface IncomingOrderPayload {
  retailer: string;
  orderId: string;
  orderDate: string;
  grandTotal: number;
  items: Array<{ name: string; quantity: number; price: number }>;
}

function isValidPayload(body: unknown): body is IncomingOrderPayload {
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
    b.items.every(
      (item) =>
        typeof item === "object" &&
        item !== null &&
        typeof (item as any).name === "string" &&
        (item as any).name.length <= 500 &&
        typeof (item as any).quantity === "number" &&
        typeof (item as any).price === "number",
    )
  );
}

ordersRouter.post("/", async (req, res) => {
  const body = req.body;
  if (!isValidPayload(body)) {
    res.status(400).json({ error: "Invalid order payload" });
    return;
  }

  const existing = findByRetailerAndExternalId(body.retailer, body.orderId);
  if (existing) {
    res.status(409).json({ error: "Order already pending review", id: existing.id });
    return;
  }

  const alreadyProcessed = await findTransactionNoteMatch(
    body.retailer,
    body.orderId,
    body.orderDate,
    addDays(body.orderDate, 5),
  );
  if (alreadyProcessed) {
    res.status(409).json({ error: "Order already applied to a transaction in Actual" });
    return;
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

  res.status(201).json({ id });
});

ordersRouter.get("/pending", (_req, res) => {
  const orders = getPendingOrders().map((o) => ({
    id: o.id,
    retailer: o.retailer,
    orderId: o.external_order_id,
    orderDate: o.order_date,
    grandTotal: o.grand_total,
    status: o.status,
    proposed: o.proposed_json ? JSON.parse(o.proposed_json) : null,
  }));
  res.json(orders);
});

ordersRouter.get("/:id/candidates", async (req, res) => {
  const order = getOrderById(req.params.id);
  if (!order) {
    res.status(404).json({ error: "Order not found" });
    return;
  }
  const candidates = await findUncategorizedCandidates({
    payeeMatch: order.retailer,
    dateFrom: order.order_date,
    dateTo: addDays(order.order_date, 5),
    targetAmount: order.grand_total,
  });
  res.json(candidates);
});

ordersRouter.post("/:id/categorize", async (req, res) => {
  const order = getOrderById(req.params.id);
  if (!order) {
    res.status(404).json({ error: "Order not found" });
    return;
  }
  const payload = JSON.parse(order.payload_json) as IncomingOrderPayload;
  const categories = await getAvailableCategories();
  const result = await categorizeOrder({
    retailer: order.retailer,
    items: payload.items.map((i) => ({ name: i.name, quantity: i.quantity, price: i.price })),
    grandTotal: order.grand_total,
    categories,
  });
  setProposed(order.id, JSON.stringify(result));
  res.json(result);
});

interface ApproveLink {
  transactionId: string;
  accountId: string;
  date: string;
  transactionAmount: number;
  allocations: Array<{ categoryId: string; amount: number; notes?: string }>;
}

ordersRouter.post("/:id/approve", async (req, res) => {
  const order = getOrderById(req.params.id);
  if (!order) {
    res.status(404).json({ error: "Order not found" });
    return;
  }

  const links = (req.body?.links ?? []) as ApproveLink[];
  if (!Array.isArray(links) || links.length === 0) {
    res.status(400).json({ error: "At least one transaction link is required" });
    return;
  }

  for (const link of links) {
    const sum = link.allocations.reduce((total, a) => total + a.amount, 0);
    if (sum !== link.transactionAmount) {
      res.status(400).json({
        error: `Allocations for transaction ${link.transactionId} sum to ${sum}, expected ${link.transactionAmount}`,
      });
      return;
    }
  }

  for (const link of links) {
    await writeSplit({
      transactionId: link.transactionId,
      accountId: link.accountId,
      date: link.date,
      allocations: link.allocations,
      orderMarker: orderMarker(order.retailer, order.external_order_id),
    });
  }

  deleteOrder(order.id);
  res.status(204).send();
});

ordersRouter.post("/:id/reject", (req, res) => {
  const order = getOrderById(req.params.id);
  if (!order) {
    res.status(404).json({ error: "Order not found" });
    return;
  }
  markRejected(order.id);
  deleteOrder(order.id);
  res.status(204).send();
});

function addDays(isoDate: string, days: number): string {
  const date = new Date(isoDate);
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { config } from "./config.js";

export type OrderStatus = "pending" | "categorized" | "rejected";

export interface OrderRow {
  id: string;
  retailer: string;
  external_order_id: string;
  order_date: string;
  grand_total: number;
  payload_json: string;
  proposed_json: string | null;
  status: OrderStatus;
  created_at: string;
  updated_at: string;
}

mkdirSync(dirname(config.db.path), { recursive: true });
const db = new Database(config.db.path);
db.pragma("journal_mode = WAL");

// Single transient table: never mirrors Actual data, only holds scraped
// orders awaiting human review. Rows are deleted once approved or rejected.
db.exec(`
  CREATE TABLE IF NOT EXISTS orders (
    id                 TEXT PRIMARY KEY,
    retailer           TEXT NOT NULL,
    external_order_id  TEXT NOT NULL,
    order_date         TEXT NOT NULL,
    grand_total        INTEGER NOT NULL,
    payload_json       TEXT NOT NULL,
    proposed_json      TEXT,
    status             TEXT NOT NULL DEFAULT 'pending',
    created_at         TEXT NOT NULL,
    updated_at         TEXT NOT NULL,
    UNIQUE (retailer, external_order_id)
  );
`);

export function insertOrder(order: {
  id: string;
  retailer: string;
  externalOrderId: string;
  orderDate: string;
  grandTotal: number;
  payloadJson: string;
}): void {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO orders (id, retailer, external_order_id, order_date, grand_total, payload_json, status, created_at, updated_at)
     VALUES (@id, @retailer, @externalOrderId, @orderDate, @grandTotal, @payloadJson, 'pending', @now, @now)`,
  ).run({ ...order, now });
}

export function findByRetailerAndExternalId(retailer: string, externalOrderId: string): OrderRow | undefined {
  return db
    .prepare(`SELECT * FROM orders WHERE retailer = ? AND external_order_id = ?`)
    .get(retailer, externalOrderId) as OrderRow | undefined;
}

export function getPendingOrders(): OrderRow[] {
  return db.prepare(`SELECT * FROM orders WHERE status != 'rejected' ORDER BY created_at DESC`).all() as OrderRow[];
}

export function getOrderById(id: string): OrderRow | undefined {
  return db.prepare(`SELECT * FROM orders WHERE id = ?`).get(id) as OrderRow | undefined;
}

export function setProposed(id: string, proposedJson: string): void {
  db.prepare(`UPDATE orders SET proposed_json = ?, status = 'categorized', updated_at = ? WHERE id = ?`).run(
    proposedJson,
    new Date().toISOString(),
    id,
  );
}

export function markRejected(id: string): void {
  db.prepare(`UPDATE orders SET status = 'rejected', updated_at = ? WHERE id = ?`).run(new Date().toISOString(), id);
}

export function deleteOrder(id: string): void {
  db.prepare(`DELETE FROM orders WHERE id = ?`).run(id);
}

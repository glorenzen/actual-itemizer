import * as api from "@actual-app/api";
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { config } from "./config.js";

export interface Category {
  id: string;
  name: string;
  groupName: string;
}

export interface CandidateTransaction {
  id: string;
  accountId: string;
  date: string;
  amount: number;
  payeeName: string;
}

export interface Allocation {
  categoryId: string;
  amount: number;
  notes?: string;
}

let initialized = false;

export async function initActual(): Promise<void> {
  if (initialized) return;
  // @actual-app/api expects dataDir to already exist; it won't create it.
  mkdirSync(config.actual.dataDir, { recursive: true });
  await api.init({
    serverURL: config.actual.serverURL,
    password: config.actual.password,
    dataDir: config.actual.dataDir,
  });
  await api.downloadBudget(
    config.actual.syncId,
    config.actual.e2ePassword ? { password: config.actual.e2ePassword } : undefined,
  );
  initialized = true;
}

export async function shutdownActual(): Promise<void> {
  if (!initialized) return;
  await api.shutdown();
  initialized = false;
}

export async function getAvailableCategories(): Promise<Category[]> {
  const groups = await api.getCategoryGroups();
  return groups.flatMap((group) =>
    (group.categories ?? []).map((category) => ({
      id: category.id,
      name: category.name,
      groupName: group.name,
    })),
  );
}

/**
 * Finds uncategorized transactions in the given date window whose payee name
 * contains `payeeMatch`. Matching is a manual step in the review UI, so this
 * intentionally does not filter by amount — it only sorts by closeness.
 */
export async function findUncategorizedCandidates(opts: {
  payeeMatch: string;
  dateFrom: string;
  dateTo: string;
  targetAmount: number;
}): Promise<CandidateTransaction[]> {
  const [accounts, payees] = await Promise.all([api.getAccounts(), api.getPayees()]);
  const matchingPayeeIds = new Set(
    payees.filter((p) => p.name.toLowerCase().includes(opts.payeeMatch.toLowerCase())).map((p) => p.id),
  );

  const results: CandidateTransaction[] = [];
  for (const account of accounts) {
    const transactions = await api.getTransactions(account.id, opts.dateFrom, opts.dateTo);
    for (const t of transactions) {
      if (t.category != null) continue;
      if (t.payee == null || !matchingPayeeIds.has(t.payee)) continue;
      const payee = payees.find((p) => p.id === t.payee);
      results.push({
        id: t.id,
        accountId: account.id,
        date: t.date,
        amount: t.amount,
        payeeName: payee?.name ?? "",
      });
    }
  }

  return results.sort((a, b) => Math.abs(a.amount - opts.targetAmount) - Math.abs(b.amount - opts.targetAmount));
}

/**
 * Turns a single uncategorized transaction into a split (parent + subtransactions).
 * Caller is responsible for ensuring allocation amounts sum to the transaction amount.
 * The parent's `notes` field is tagged with the source order id so re-submitted
 * orders can be detected later — there is no separate note API in @actual-app/api.
 */
export async function writeSplit(params: {
  transactionId: string;
  accountId: string;
  date: string;
  allocations: Allocation[];
  orderMarker: string;
}): Promise<void> {
  const total = params.allocations.reduce((sum, a) => sum + a.amount, 0);
  const subtransactions = params.allocations.map((allocation) => ({
    id: randomUUID(),
    amount: allocation.amount,
    account: params.accountId,
    date: params.date,
    parent_id: params.transactionId,
    is_child: true as const,
    is_parent: false as const,
    category: allocation.categoryId,
    notes: allocation.notes,
  }));

  await api.updateTransaction(params.transactionId, {
    is_parent: true,
    notes: params.orderMarker,
    subtransactions,
  });

  void total; // sum validated by caller before invoking this function
}

export function orderMarker(retailer: string, externalOrderId: string): string {
  return `order:${retailer}:${externalOrderId}`;
}

export async function findTransactionNoteMatch(
  retailer: string,
  externalOrderId: string,
  dateFrom: string,
  dateTo: string,
): Promise<boolean> {
  const accounts = await api.getAccounts();
  const marker = orderMarker(retailer, externalOrderId);
  for (const account of accounts) {
    const transactions = await api.getTransactions(account.id, dateFrom, dateTo);
    if (transactions.some((t) => t.notes === marker)) return true;
  }
  return false;
}

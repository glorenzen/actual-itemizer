"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";

interface OrderItem {
  name: string;
  quantity: number;
  price: number;
}

interface CategorizationResult {
  allocations: Array<{ itemName: string; categoryName: string; amount: number }>;
  unallocatedAmount: number;
  notes: string;
}

interface PendingOrder {
  id: string;
  retailer: string;
  orderId: string;
  orderDate: string;
  grandTotal: number;
  status: string;
  taxRatePercent: number;
  proposed: CategorizationResult | null;
  payload?: {
    items?: OrderItem[];
    taxAmount?: number | null;
  };
}

interface Category {
  id: string;
  name: string;
  groupName: string;
}

interface CandidateTransaction {
  id: string;
  accountId: string;
  date: string;
  amount: number;
  payeeName: string;
}

interface AllocationRow {
  itemName: string;
  quantity: number;
  baseAmount: number;
  taxAmount: number;
  amount: number;
  categoryId: string;
}

const SECRET_STORAGE_KEY = "actual-itemizer-secret";
const SECRET_CHANGED_EVENT = "actual-itemizer-secret-changed";

// The secret lives in localStorage; useSyncExternalStore keeps it readable
// during render without a setState-in-effect or an SSR hydration mismatch.
function subscribeSecret(callback: () => void): () => void {
  window.addEventListener("storage", callback);
  window.addEventListener(SECRET_CHANGED_EVENT, callback);
  return () => {
    window.removeEventListener("storage", callback);
    window.removeEventListener(SECRET_CHANGED_EVENT, callback);
  };
}

function getSecretSnapshot(): string {
  return localStorage.getItem(SECRET_STORAGE_KEY) ?? "";
}

function getSecretServerSnapshot(): string {
  return "";
}

function storeSecret(value: string): void {
  localStorage.setItem(SECRET_STORAGE_KEY, value);
  window.dispatchEvent(new Event(SECRET_CHANGED_EVENT));
}

async function api<T = unknown>(path: string, secret: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...options,
    headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `Request failed: ${res.status}`);
  }
  return (res.status === 204 ? null : await res.json()) as T;
}

let categoriesCache: Promise<Category[]> | null = null;
function getCategories(secret: string): Promise<Category[]> {
  categoriesCache ??= api<Category[]>("/categories", secret);
  return categoriesCache;
}

function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

// The LLM is prompted with "Group > Category" labels, so match on that full
// label first, falling back to a bare category-name match.
function matchCategoryId(proposedName: string, categories: Category[]): string | null {
  const target = proposedName.trim().toLowerCase();
  return (
    categories.find((c) => `${c.groupName} > ${c.name}`.toLowerCase() === target)?.id ??
    categories.find((c) => c.name.toLowerCase() === target)?.id ??
    null
  );
}

function defaultAdjustmentCategoryId(categories: Category[]): string {
  return (
    categories.find((c) => /tax|fee|shipping/i.test(`${c.groupName} ${c.name}`))?.id ??
    categories[0]?.id ??
    ""
  );
}

// Turns proposed per-unit allocations into line amounts in cents and spreads
// the order's tax across them proportionally (last row takes the rounding
// remainder so the tax sums exactly).
function buildAllocationRows(
  proposed: CategorizationResult,
  orderItems: OrderItem[],
  invoiceTaxAmount: number | null,
  taxRatePercent: number,
  categories: Category[],
): AllocationRow[] {
  const rows = proposed.allocations.map((allocation) => {
    const sourceItem = orderItems.find(
      (item) => item.name.trim().toLowerCase() === allocation.itemName.trim().toLowerCase(),
    );
    const quantity = sourceItem?.quantity ?? 1;
    const baseAmount = Math.round(allocation.amount * quantity * 100);
    return {
      itemName: allocation.itemName,
      quantity,
      baseAmount,
      taxAmount: 0,
      amount: baseAmount,
      categoryId: matchCategoryId(allocation.categoryName, categories) ?? categories[0]?.id ?? "",
    };
  });

  const itemSubtotal = rows.reduce((sum, row) => sum + row.baseAmount, 0);
  const taxTotal =
    invoiceTaxAmount != null
      ? invoiceTaxAmount
      : itemSubtotal > 0
        ? Math.round((itemSubtotal * Number(taxRatePercent)) / 100)
        : 0;

  if (rows.length > 0 && itemSubtotal > 0 && taxTotal !== 0) {
    let assignedTax = 0;
    rows.forEach((row, index) => {
      const taxAmount =
        index === rows.length - 1
          ? taxTotal - assignedTax
          : Math.round((taxTotal * row.baseAmount) / itemSubtotal);
      assignedTax += taxAmount;
      row.taxAmount = taxAmount;
      row.amount = row.baseAmount + taxAmount;
    });
  }

  return rows;
}

export default function ReviewQueue() {
  const secret = useSyncExternalStore(subscribeSecret, getSecretSnapshot, getSecretServerSnapshot);
  const [orders, setOrders] = useState<PendingOrder[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [selectedOrder, setSelectedOrder] = useState<PendingOrder | null>(null);

  const loadPending = useCallback(() => {
    if (!secret) return;
    api<PendingOrder[]>("/orders/pending", secret)
      .then((data) => {
        setListError(null);
        setOrders(data);
      })
      .catch((err: unknown) => {
        setListError(err instanceof Error ? err.message : String(err));
        setOrders(null);
      });
  }, [secret]);

  useEffect(() => {
    loadPending();
  }, [loadPending]);

  return (
    <div className="mx-auto w-full max-w-[900px] p-6 text-zinc-900 dark:text-zinc-100">
      <header className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Actual Itemizer</h1>
        <label className="flex items-center gap-2 text-sm">
          Shared secret
          <input
            type="password"
            value={secret}
            onChange={(e) => {
              storeSecret(e.target.value);
              setOrders(null);
              setListError(null);
            }}
            placeholder="••••••"
            className="rounded border border-zinc-300 bg-transparent px-2 py-1 dark:border-zinc-700"
          />
        </label>
      </header>

      <main>
        <section>
          <h2 className="mb-2 text-lg font-medium">Pending Orders</h2>
          {!secret && <p className="text-sm text-zinc-500">Enter the shared secret to load pending orders.</p>}
          {listError && <p className="text-red-700 dark:text-red-400">{listError}</p>}
          {orders && orders.length === 0 && <p className="text-sm text-zinc-500">No pending orders.</p>}
          <ul>
            {(orders ?? []).map((order) => (
              <li
                key={order.id}
                onClick={() => setSelectedOrder(order)}
                className="mb-2 flex cursor-pointer justify-between rounded-md border border-zinc-300 p-3 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
              >
                {`${order.retailer} — ${order.orderDate} — ${formatCents(order.grandTotal)} (${order.status})`}
              </li>
            ))}
          </ul>
        </section>

        {selectedOrder && (
          <section className="mt-6">
            <h2 className="mb-2 text-lg font-medium">Review Order</h2>
            <OrderDetail
              key={selectedOrder.id}
              order={selectedOrder}
              secret={secret}
              onDone={() => {
                setSelectedOrder(null);
                loadPending();
              }}
            />
          </section>
        )}
      </main>
    </div>
  );
}

function OrderDetail({
  order,
  secret,
  onDone,
}: {
  order: PendingOrder;
  secret: string;
  onDone: () => void;
}) {
  const [categories, setCategories] = useState<Category[] | null>(null);
  const [candidates, setCandidates] = useState<CandidateTransaction[] | null>(null);
  const [itemRows, setItemRows] = useState<AllocationRow[] | null>(null);
  const [loadingMessage, setLoadingMessage] = useState("Loading matching Actual transactions…");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(new Set());
  const [adjustmentCategoryId, setAdjustmentCategoryId] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [cats, cands] = await Promise.all([
          getCategories(secret),
          api<CandidateTransaction[]>(`/orders/${order.id}/candidates`, secret),
        ]);
        if (cancelled) return;
        let proposed = order.proposed;
        if (!proposed) {
          setLoadingMessage("Asking LocalAI for category suggestions…");
          proposed = await api<CategorizationResult>(`/orders/${order.id}/categorize`, secret, {
            method: "POST",
          });
          if (cancelled) return;
        }
        setCategories(cats);
        setCandidates(cands);
        setItemRows(
          buildAllocationRows(
            proposed,
            order.payload?.items ?? [],
            order.payload?.taxAmount ?? null,
            order.taxRatePercent ?? 0,
            cats,
          ),
        );
        setAdjustmentCategoryId(defaultAdjustmentCategoryId(cats));
      } catch (err) {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [order, secret]);

  if (loadError) {
    return <p className="text-red-700 dark:text-red-400">Unable to load this order: {loadError}</p>;
  }
  if (!categories || !candidates || !itemRows) {
    return <p>{loadingMessage}</p>;
  }

  const selectedTotal = candidates
    .filter((c) => selectedIds.has(c.id))
    .reduce((sum, c) => sum + Math.abs(c.amount), 0);
  const itemTotal = itemRows.reduce((sum, row) => sum + row.amount, 0);
  const adjustmentAmount = selectedTotal - itemTotal;

  const toggleCandidate = (id: string, checked: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  const updateRowCategory = (index: number, categoryId: string) => {
    setItemRows((rows) => rows?.map((row, i) => (i === index ? { ...row, categoryId } : row)) ?? null);
  };

  const approve = async () => {
    setActionError(null);
    if (selectedIds.size === 0) {
      setActionError("Select at least one matching transaction to link this order to.");
      return;
    }
    // v1: if a single transaction is selected, all item allocations apply to
    // it. Multi-charge orders must be split manually in Actual after approval.
    if (selectedIds.size > 1) {
      setActionError("Multiple linked transactions aren't auto-split yet — approve one at a time.");
      return;
    }
    const transactionId = [...selectedIds][0];
    const candidate = candidates.find((c) => c.id === transactionId);
    if (!candidate) return;

    const allocations = itemRows.map((row) => ({ categoryId: row.categoryId, amount: row.amount }));
    if (adjustmentAmount > 0) {
      allocations.push({ categoryId: adjustmentCategoryId, amount: adjustmentAmount });
    }

    setBusy(true);
    try {
      await api(`/orders/${order.id}/approve`, secret, {
        method: "POST",
        body: JSON.stringify({
          links: [
            {
              transactionId: candidate.id,
              accountId: candidate.accountId,
              date: candidate.date,
              transactionAmount: candidate.amount,
              allocations,
            },
          ],
        }),
      });
      onDone();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const reject = async () => {
    setActionError(null);
    setBusy(true);
    try {
      await api(`/orders/${order.id}/reject`, secret, { method: "POST" });
      onDone();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const categorySelect = (value: string, onChange: (categoryId: string) => void) => (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="max-w-full rounded border border-zinc-300 bg-transparent px-1 py-0.5 dark:border-zinc-700"
    >
      {categories.map((cat) => (
        <option key={cat.id} value={cat.id}>
          {cat.groupName} &gt; {cat.name}
        </option>
      ))}
    </select>
  );

  return (
    <div>
      <div className="mb-4">
        <h3 className="mb-1 font-medium">Matching uncategorized transactions</h3>
        {candidates.length === 0 && (
          <p className="text-sm text-zinc-500">No uncategorized transactions found near this order date.</p>
        )}
        {candidates.map((c) => (
          <label key={c.id} className="flex items-center gap-2 py-1">
            <input
              type="checkbox"
              checked={selectedIds.has(c.id)}
              onChange={(e) => toggleCandidate(c.id, e.target.checked)}
            />
            {`${c.date} — ${c.payeeName} — ${formatCents(Math.abs(c.amount))}`}
          </label>
        ))}
      </div>

      <table className="my-4 w-full border-collapse">
        <thead>
          <tr>
            <th className="border-b border-zinc-200 p-2 text-left dark:border-zinc-700">Item</th>
            <th className="border-b border-zinc-200 p-2 text-left dark:border-zinc-700">Amount</th>
            <th className="border-b border-zinc-200 p-2 text-left dark:border-zinc-700">Category</th>
          </tr>
        </thead>
        <tbody>
          {itemRows.map((row, index) => (
            <tr key={index}>
              <td className="border-b border-zinc-200 p-2 dark:border-zinc-700">
                {row.itemName}
                {row.quantity > 1 ? ` (x${row.quantity})` : ""}
              </td>
              <td
                className="border-b border-zinc-200 p-2 dark:border-zinc-700"
                title={row.taxAmount > 0 ? `Includes ${formatCents(row.taxAmount)} tax` : undefined}
              >
                {formatCents(row.amount)}
              </td>
              <td className="border-b border-zinc-200 p-2 dark:border-zinc-700">
                {categorySelect(row.categoryId, (categoryId) => updateRowCategory(index, categoryId))}
              </td>
            </tr>
          ))}
          {adjustmentAmount > 0 && (
            <tr>
              <td className="border-b border-zinc-200 p-2 dark:border-zinc-700">Other order adjustment</td>
              <td className="border-b border-zinc-200 p-2 dark:border-zinc-700">
                {formatCents(adjustmentAmount)}
              </td>
              <td className="border-b border-zinc-200 p-2 dark:border-zinc-700">
                {categorySelect(adjustmentCategoryId, setAdjustmentCategoryId)}
              </td>
            </tr>
          )}
        </tbody>
      </table>

      <div className="flex gap-2">
        <button
          onClick={approve}
          disabled={busy}
          className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
        >
          Approve &amp; write to Actual
        </button>
        <button
          onClick={reject}
          disabled={busy}
          className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
        >
          Reject
        </button>
      </div>
      {actionError && <p className="mt-2 text-red-700 dark:text-red-400">{actionError}</p>}
    </div>
  );
}

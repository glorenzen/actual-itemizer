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
    <div className="flex min-h-full flex-1 flex-col bg-stone-100 text-stone-900 dark:bg-stone-950 dark:text-stone-100">
      <header className="sticky top-0 z-10 flex items-center justify-between border-b border-stone-200 bg-stone-50/90 px-6 py-3 backdrop-blur dark:border-stone-800 dark:bg-stone-900/90">
        <div className="flex items-baseline gap-3">
          <h1 className="text-lg font-semibold tracking-tight">Actual Itemizer</h1>
          <span className="text-xs text-stone-500 dark:text-stone-400">Review queue</span>
        </div>
        <label className="flex items-center gap-2 text-sm text-stone-600 dark:text-stone-300">
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
            className="w-44 rounded-md border border-stone-300 bg-white px-2.5 py-1.5 text-sm shadow-sm outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-500/30 dark:border-stone-700 dark:bg-stone-800"
          />
        </label>
      </header>

      <main className="mx-auto flex w-full max-w-6xl flex-1 gap-6 p-6">
        <aside className="w-80 shrink-0">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-stone-500 dark:text-stone-400">
              Pending orders
            </h2>
            {orders && (
              <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">
                {orders.length}
              </span>
            )}
          </div>

          {!secret && (
            <p className="rounded-lg border border-dashed border-stone-300 p-4 text-sm text-stone-500 dark:border-stone-700 dark:text-stone-400">
              Enter the shared secret to load pending orders.
            </p>
          )}
          {listError && (
            <p className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-400">
              {listError}
            </p>
          )}
          {secret && orders && orders.length === 0 && (
            <p className="rounded-lg border border-dashed border-stone-300 p-4 text-sm text-stone-500 dark:border-stone-700 dark:text-stone-400">
              No pending orders. Send one from the browser extension.
            </p>
          )}

          <ul className="space-y-2">
            {(orders ?? []).map((order) => {
              const isSelected = selectedOrder?.id === order.id;
              return (
                <li key={order.id}>
                  <button
                    onClick={() => setSelectedOrder(order)}
                    className={`w-full rounded-lg border p-3 text-left shadow-sm transition-colors ${
                      isSelected
                        ? "border-amber-500 bg-amber-50 ring-1 ring-amber-500/40 dark:border-amber-600 dark:bg-amber-950/30"
                        : "border-stone-200 bg-white hover:border-amber-400/60 hover:bg-amber-50/50 dark:border-stone-800 dark:bg-stone-900 dark:hover:border-amber-700/60 dark:hover:bg-stone-800/60"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium capitalize">{order.retailer}</span>
                      <span className="font-mono text-sm">{formatCents(order.grandTotal)}</span>
                    </div>
                    <div className="mt-1 flex items-center justify-between gap-2 text-xs text-stone-500 dark:text-stone-400">
                      <span>{order.orderDate}</span>
                      <span
                        className={`rounded-full px-1.5 py-0.5 ${
                          order.status === "categorized"
                            ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300"
                            : "bg-stone-200 text-stone-600 dark:bg-stone-800 dark:text-stone-300"
                        }`}
                      >
                        {order.status}
                      </span>
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        </aside>

        <section className="min-w-0 flex-1">
          {selectedOrder ? (
            <OrderDetail
              key={selectedOrder.id}
              order={selectedOrder}
              secret={secret}
              onDone={() => {
                setSelectedOrder(null);
                loadPending();
              }}
            />
          ) : (
            <div className="flex h-full items-center justify-center rounded-lg border border-dashed border-stone-300 text-sm text-stone-400 dark:border-stone-700 dark:text-stone-500">
              Select an order to review
            </div>
          )}
        </section>
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
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-400">
        Unable to load this order: {loadError}
      </div>
    );
  }
  if (!categories || !candidates || !itemRows) {
    return (
      <div className="flex items-center gap-3 rounded-lg border border-stone-200 bg-white p-6 text-sm text-stone-500 shadow-sm dark:border-stone-800 dark:bg-stone-900 dark:text-stone-400">
        <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-amber-500 border-t-transparent" />
        {loadingMessage}
      </div>
    );
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
      className="w-full max-w-xs rounded-md border border-stone-300 bg-white px-2 py-1.5 text-sm shadow-sm outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-500/30 dark:border-stone-700 dark:bg-stone-800"
    >
      {categories.map((cat) => (
        <option key={cat.id} value={cat.id}>
          {cat.groupName} &gt; {cat.name}
        </option>
      ))}
    </select>
  );

  return (
    <div className="space-y-5">
      <div className="rounded-lg border border-stone-200 bg-white p-4 shadow-sm dark:border-stone-800 dark:bg-stone-900">
        <div className="flex items-baseline justify-between gap-2">
          <h3 className="font-medium capitalize">{order.retailer} order</h3>
          <span className="font-mono text-sm">{formatCents(order.grandTotal)}</span>
        </div>
        <p className="mt-0.5 text-xs text-stone-500 dark:text-stone-400">
          {order.orderDate} · #{order.orderId}
        </p>
      </div>

      <div className="rounded-lg border border-stone-200 bg-white p-4 shadow-sm dark:border-stone-800 dark:bg-stone-900">
        <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-stone-500 dark:text-stone-400">
          Matching uncategorized transactions
        </h3>
        {candidates.length === 0 && (
          <p className="text-sm text-stone-500 dark:text-stone-400">
            No uncategorized transactions found near this order date.
          </p>
        )}
        <div className="space-y-1">
          {candidates.map((c) => (
            <label
              key={c.id}
              className="flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 text-sm hover:bg-stone-50 dark:hover:bg-stone-800/60"
            >
              <input
                type="checkbox"
                checked={selectedIds.has(c.id)}
                onChange={(e) => toggleCandidate(c.id, e.target.checked)}
                className="h-4 w-4 rounded border-stone-300 text-amber-600 accent-amber-600 focus:ring-amber-500/40 dark:border-stone-600"
              />
              <span className="flex-1">
                {c.date} — {c.payeeName}
              </span>
              <span className="font-mono text-sm">{formatCents(Math.abs(c.amount))}</span>
            </label>
          ))}
        </div>
      </div>

      <div className="overflow-hidden rounded-lg border border-stone-200 bg-white shadow-sm dark:border-stone-800 dark:bg-stone-900">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="bg-stone-50 text-left text-xs uppercase tracking-wide text-stone-500 dark:bg-stone-800/60 dark:text-stone-400">
              <th className="px-4 py-2.5 font-medium">Item</th>
              <th className="px-4 py-2.5 font-medium">Amount</th>
              <th className="px-4 py-2.5 font-medium">Category</th>
            </tr>
          </thead>
          <tbody>
            {itemRows.map((row, index) => (
              <tr key={index} className="border-t border-stone-100 dark:border-stone-800">
                <td className="px-4 py-2.5">
                  {row.itemName}
                  {row.quantity > 1 ? (
                    <span className="ml-1 text-stone-500 dark:text-stone-400">×{row.quantity}</span>
                  ) : (
                    ""
                  )}
                </td>
                <td
                  className="px-4 py-2.5 font-mono"
                  title={row.taxAmount > 0 ? `Includes ${formatCents(row.taxAmount)} tax` : undefined}
                >
                  {formatCents(row.amount)}
                </td>
                <td className="px-4 py-2.5">
                  {categorySelect(row.categoryId, (categoryId) => updateRowCategory(index, categoryId))}
                </td>
              </tr>
            ))}
            {adjustmentAmount > 0 && (
              <tr className="border-t border-amber-200 bg-amber-50/60 dark:border-amber-900/40 dark:bg-amber-950/20">
                <td className="px-4 py-2.5 font-medium">Other order adjustment</td>
                <td className="px-4 py-2.5 font-mono">{formatCents(adjustmentAmount)}</td>
                <td className="px-4 py-2.5">{categorySelect(adjustmentCategoryId, setAdjustmentCategoryId)}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="flex items-center gap-3">
        <button
          onClick={approve}
          disabled={busy}
          className="rounded-md bg-amber-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-amber-500 disabled:opacity-50 dark:bg-amber-600 dark:hover:bg-amber-500"
        >
          {busy ? "Working…" : "Approve & write to Actual"}
        </button>
        <button
          onClick={reject}
          disabled={busy}
          className="rounded-md border border-stone-300 bg-white px-4 py-2 text-sm font-medium text-stone-700 shadow-sm transition-colors hover:bg-stone-50 disabled:opacity-50 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-200 dark:hover:bg-stone-800"
        >
          Reject
        </button>
      </div>
      {actionError && (
        <p className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-400">
          {actionError}
        </p>
      )}
    </div>
  );
}

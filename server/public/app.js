const secretInput = document.getElementById("secret");
secretInput.value = localStorage.getItem("actual-itemizer-secret") ?? "";
secretInput.addEventListener("change", () => {
  localStorage.setItem("actual-itemizer-secret", secretInput.value);
});

function authHeaders() {
  return { Authorization: `Bearer ${secretInput.value}`, "Content-Type": "application/json" };
}

async function api(path, options = {}) {
  const res = await fetch(`/api${path}`, { ...options, headers: { ...authHeaders(), ...(options.headers ?? {}) } });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `Request failed: ${res.status}`);
  }
  return res.status === 204 ? null : res.json();
}

const ordersList = document.getElementById("orders");
const detailSection = document.getElementById("order-detail");
const detailContent = document.getElementById("detail-content");

async function loadPending() {
  const orders = await api("/orders/pending");
  ordersList.innerHTML = "";
  for (const order of orders) {
    const li = document.createElement("li");
    li.className = "order-row";
    li.textContent = `${order.retailer} — ${order.orderDate} — $${(order.grandTotal / 100).toFixed(2)} (${order.status})`;
    li.addEventListener("click", () => openOrder(order));
    ordersList.appendChild(li);
  }
}

let categoriesCache = null;
async function getCategories() {
  categoriesCache ??= await api("/categories");
  return categoriesCache;
}

async function openOrder(order) {
  detailSection.hidden = false;
  detailContent.innerHTML = "<p>Loading matching Actual transactions…</p>";

  try {
    const [categories, candidates] = await Promise.all([
      getCategories(),
      api(`/orders/${order.id}/candidates`),
    ]);
    let proposed = order.proposed;
    if (!proposed) {
      detailContent.innerHTML = "<p>Asking LocalAI for category suggestions…</p>";
      proposed = await api(`/orders/${order.id}/categorize`, { method: "POST" });
    }

    renderDetail(order.id, categories, candidates, proposed);
  } catch (error) {
    detailContent.innerHTML = `<p class="warning">Unable to load this order: ${escapeHtml(error.message)}</p>`;
  }
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[character]));
}

function renderDetail(orderId, categories, candidates, proposed) {
  detailContent.innerHTML = "";

  const candidateBox = document.createElement("div");
  candidateBox.innerHTML = "<h3>Matching uncategorized transactions</h3>";
  const selectedTransactionIds = new Set();
  for (const c of candidates) {
    const row = document.createElement("div");
    row.className = "candidate";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.addEventListener("change", () => {
      if (checkbox.checked) selectedTransactionIds.add(c.id);
      else selectedTransactionIds.delete(c.id);
    });
    row.appendChild(checkbox);
    row.append(`${c.date} — ${c.payeeName} — $${(c.amount / 100).toFixed(2)}`);
    row.dataset.transactionId = c.id;
    candidateBox.appendChild(row);
  }
  detailContent.appendChild(candidateBox);

  const table = document.createElement("table");
  table.innerHTML = "<tr><th>Item</th><th>Amount</th><th>Category</th></tr>";
  const allocationRows = [];
  for (const allocation of proposed.allocations) {
    const tr = document.createElement("tr");
    const select = document.createElement("select");
    for (const cat of categories) {
      const opt = document.createElement("option");
      const combinedLabel = `${cat.groupName} > ${cat.name}`;
      opt.value = cat.id;
      opt.textContent = combinedLabel;
      // The LLM is prompted with "Group > Category" labels, so match on that
      // full label first, falling back to a bare category-name match.
      const proposedName = allocation.categoryName.trim().toLowerCase();
      if (combinedLabel.toLowerCase() === proposedName || cat.name.toLowerCase() === proposedName) {
        opt.selected = true;
      }
      select.appendChild(opt);
    }
    tr.innerHTML = `<td>${allocation.itemName}</td><td>$${allocation.amount.toFixed(2)}</td>`;
    const td = document.createElement("td");
    td.appendChild(select);
    tr.appendChild(td);
    table.appendChild(tr);
    allocationRows.push({ itemName: allocation.itemName, amount: Math.round(allocation.amount * 100), select });
  }
  detailContent.appendChild(table);

  if (proposed.unallocatedAmount) {
    const p = document.createElement("p");
    p.className = "warning";
    p.textContent = `Unallocated (tax/shipping/fees): $${proposed.unallocatedAmount.toFixed(2)} — assign it to a category before approving.`;
    detailContent.appendChild(p);
  }

  const actions = document.createElement("div");
  actions.className = "actions";
  const approveBtn = document.createElement("button");
  approveBtn.textContent = "Approve & write to Actual";
  approveBtn.addEventListener("click", () =>
    approve(orderId, candidates, selectedTransactionIds, allocationRows).catch((err) => alert(err.message)),
  );
  const rejectBtn = document.createElement("button");
  rejectBtn.textContent = "Reject";
  rejectBtn.addEventListener("click", () =>
    api(`/orders/${orderId}/reject`, { method: "POST" }).then(() => {
      detailSection.hidden = true;
      loadPending();
    }),
  );
  actions.append(approveBtn, rejectBtn);
  detailContent.appendChild(actions);
}

async function approve(orderId, candidates, selectedTransactionIds, allocationRows) {
  if (selectedTransactionIds.size === 0) {
    throw new Error("Select at least one matching transaction to link this order to.");
  }
  // v1: if a single transaction is selected, all item allocations apply to it.
  // For multiple selected transactions (multi-charge orders), split manually
  // in Actual after approval — flagged here rather than guessing the split.
  if (selectedTransactionIds.size > 1) {
    throw new Error("Multiple linked transactions aren't auto-split yet — approve one at a time.");
  }

  const transactionId = [...selectedTransactionIds][0];
  const candidate = candidates.find((c) => c.id === transactionId);
  const allocations = allocationRows.map((row) => ({
    categoryId: row.select.value,
    amount: row.amount,
  }));

  await api(`/orders/${orderId}/approve`, {
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

  detailSection.hidden = true;
  loadPending();
}

loadPending();

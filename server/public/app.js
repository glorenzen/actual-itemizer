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

    renderDetail(
      order.id,
      categories,
      candidates,
      proposed,
      order.payload?.items ?? [],
      order.payload?.taxAmount ?? null,
      order.taxRatePercent ?? 0,
    );
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

function renderDetail(orderId, categories, candidates, proposed, orderItems, invoiceTaxAmount, taxRatePercent) {
  detailContent.innerHTML = "";

  const candidateBox = document.createElement("div");
  candidateBox.innerHTML = "<h3>Matching uncategorized transactions</h3>";
  const selectedTransactionIds = new Set();
  let adjustmentRow = null;
  let adjustmentAmountCell = null;
  for (const c of candidates) {
    const row = document.createElement("div");
    row.className = "candidate";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.addEventListener("change", () => {
      if (checkbox.checked) selectedTransactionIds.add(c.id);
      else selectedTransactionIds.delete(c.id);
      refreshAdjustmentRow();
    });
    row.appendChild(checkbox);
    row.append(`${c.date} — ${c.payeeName} — $${(Math.abs(c.amount) / 100).toFixed(2)}`);
    row.dataset.transactionId = c.id;
    candidateBox.appendChild(row);
  }
  detailContent.appendChild(candidateBox);

  const table = document.createElement("table");
  table.innerHTML = "<tr><th>Item</th><th>Amount</th><th>Category</th></tr>";
  const allocationRows = [];
  const itemAllocationRows = [];
  for (const allocation of proposed.allocations) {
    const sourceItem = orderItems.find((item) => item.name.trim().toLowerCase() === allocation.itemName.trim().toLowerCase());
    const quantity = sourceItem?.quantity ?? 1;
    const lineAmount = Math.round(allocation.amount * quantity * 100);
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
    tr.innerHTML = `<td>${allocation.itemName}${quantity > 1 ? ` (x${quantity})` : ""}</td>`;
    const amountCell = document.createElement("td");
    amountCell.textContent = `$${(lineAmount / 100).toFixed(2)}`;
    const td = document.createElement("td");
    td.appendChild(select);
    tr.appendChild(amountCell);
    tr.appendChild(td);
    table.appendChild(tr);
    const row = { itemName: allocation.itemName, amount: lineAmount, baseAmount: lineAmount, amountCell, select };
    allocationRows.push(row);
    itemAllocationRows.push(row);
  }
  detailContent.appendChild(table);

  const itemSubtotal = itemAllocationRows.reduce((sum, row) => sum + row.baseAmount, 0);
  const taxTotal = invoiceTaxAmount != null
    ? invoiceTaxAmount
    : itemSubtotal > 0 ? Math.round(itemSubtotal * Number(taxRatePercent) / 100) : 0;
  let assignedTax = 0;
  itemAllocationRows.forEach((row, index) => {
    const taxAmount = index === itemAllocationRows.length - 1
      ? taxTotal - assignedTax
      : Math.round(taxTotal * row.baseAmount / itemSubtotal);
    assignedTax += taxAmount;
    row.amount = row.baseAmount + taxAmount;
    row.amountCell.textContent = `$${(row.amount / 100).toFixed(2)}`;
    if (taxAmount > 0) row.amountCell.title = `Includes $${(taxAmount / 100).toFixed(2)} tax`;
  });

  function refreshAdjustmentRow() {
    const selectedTotal = candidates
      .filter((candidate) => selectedTransactionIds.has(candidate.id))
      .reduce((sum, candidate) => sum + Math.abs(candidate.amount), 0);
    const itemTotal = itemAllocationRows.reduce((sum, row) => sum + row.amount, 0);
    const adjustmentAmount = selectedTotal - itemTotal;

    if (adjustmentAmount <= 0) {
      if (adjustmentRow) adjustmentRow.remove();
      const adjustmentIndex = allocationRows.findIndex((row) => row.itemName === "Other order adjustment");
      if (adjustmentIndex >= 0) allocationRows.splice(adjustmentIndex, 1);
      adjustmentRow = null;
      adjustmentAmountCell = null;
      return;
    }

    if (!adjustmentRow) {
      adjustmentRow = document.createElement("tr");
      const label = document.createElement("td");
      label.textContent = "Other order adjustment";
      adjustmentAmountCell = document.createElement("td");
      const categoryCell = document.createElement("td");
      const select = document.createElement("select");
      for (const cat of categories) {
        const option = document.createElement("option");
        option.value = cat.id;
        option.textContent = `${cat.groupName} > ${cat.name}`;
        if (/tax|fee|shipping/i.test(`${cat.groupName} ${cat.name}`)) option.selected = true;
        select.appendChild(option);
      }
      categoryCell.appendChild(select);
      adjustmentRow.append(label, adjustmentAmountCell, categoryCell);
      table.appendChild(adjustmentRow);
      allocationRows.push({ itemName: "Other order adjustment", amount: adjustmentAmount, select });
    }

    adjustmentAmountCell.textContent = `$${(adjustmentAmount / 100).toFixed(2)}`;
    const adjustment = allocationRows.find((row) => row.itemName === "Other order adjustment");
    if (adjustment) adjustment.amount = adjustmentAmount;
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

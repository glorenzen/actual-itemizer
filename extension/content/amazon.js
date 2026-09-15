window.__actualItemizerExtract = () => {
  const orderId = document.querySelector('[data-component="orderId"]')?.textContent?.trim()
    ?? new URLSearchParams(location.search).get("orderID");
  if (!orderId) return null;

  const dateText = document.querySelector('[data-component="orderDate"]')?.textContent?.trim();
  const parsedDate = dateText ? new Date(dateText) : null;
  const orderDate = parsedDate && !Number.isNaN(parsedDate.getTime())
    ? parsedDate.toISOString().slice(0, 10)
    : null;

  const itemEls = document.querySelectorAll('[data-component="purchasedItems"] .a-fixed-left-grid');
  const items = [...itemEls]
    .map((el) => {
      const name = el.querySelector('[data-component="itemTitle"] a')?.textContent?.trim();
      const priceText = el.querySelector('[data-component="unitPrice"] .a-offscreen')?.textContent ?? "0";
      const quantityText = el.querySelector(".od-item-view-qty")?.textContent?.trim() ?? "1";
      const quantity = Number.parseInt(quantityText, 10) || 1;
      if (!name) return null;
      return { name, quantity, price: parseCurrencyToCents(priceText) / 100 };
    })
    .filter(Boolean);

  const totalRow = [...document.querySelectorAll('[data-component="chargeSummary"] .od-line-item-row')]
    .find((row) => row.textContent?.includes("Grand Total"));
  const totalEl = totalRow?.querySelector(".od-line-item-row-content");
  const grandTotal = totalEl
    ? parseCurrencyToCents(totalEl.textContent)
    : items.reduce((sum, item) => sum + item.price * item.quantity * 100, 0);

  if (!orderDate || items.length === 0) return null;

  return {
    retailer: "amazon",
    orderId,
    orderDate,
    grandTotal,
    items,
  };
};

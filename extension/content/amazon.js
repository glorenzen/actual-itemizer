// Amazon order-details page extraction. Selectors are best-effort and may need
// updating if Amazon changes its markup — verify against a live order page.
window.__actualItemizerExtract = () => {
  const orderIdEl = document.querySelector("bdi, .order-id, [data-order-id]");
  const orderId = orderIdEl?.textContent?.trim() ?? new URLSearchParams(location.search).get("orderID");
  if (!orderId) return null;

  const dateEl = document.querySelector(".order-date-invoice-item, .a-span3 .a-text-bold");
  const orderDate = dateEl ? new Date(dateEl.textContent.trim()).toISOString().slice(0, 10) : null;

  const itemEls = document.querySelectorAll(".yohtmlc-item, .a-fixed-left-grid.item-box");
  const items = [...itemEls]
    .map((el) => {
      const name = el.querySelector(".yohtmlc-product-title, .a-link-normal")?.textContent?.trim();
      const priceText = el.querySelector(".a-color-price, .yohtmlc-item-price")?.textContent ?? "0";
      if (!name) return null;
      return { name, quantity: 1, price: parseCurrencyToCents(priceText) / 100 };
    })
    .filter(Boolean);

  const totalEl = document.querySelector(".order-total .a-color-base, .grand-total-price");
  const grandTotal = totalEl ? parseCurrencyToCents(totalEl.textContent) : items.reduce((s, i) => s + i.price * 100, 0);

  if (!orderDate || items.length === 0) return null;

  return {
    retailer: "amazon",
    orderId,
    orderDate,
    grandTotal,
    items,
  };
};

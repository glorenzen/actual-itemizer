// Target order-details page extraction. Selectors are best-effort and may need
// updating if Target changes its markup — verify against a live order page.
window.__actualItemizerExtract = () => {
  const orderId = location.pathname.split("/").filter(Boolean).pop();
  if (!orderId) return null;

  const dateEl = document.querySelector("[data-test='orderDate'], .order-date");
  const orderDate = dateEl ? new Date(dateEl.textContent.trim()).toISOString().slice(0, 10) : null;

  const itemEls = document.querySelectorAll("[data-test='orderLineItem'], .OrderLineItem");
  const items = [...itemEls]
    .map((el) => {
      const name = el.querySelector("[data-test='productTitle'], .item-title")?.textContent?.trim();
      const priceText = el.querySelector("[data-test='itemPrice'], .item-price")?.textContent ?? "0";
      if (!name) return null;
      return { name, quantity: 1, price: parseCurrencyToCents(priceText) / 100 };
    })
    .filter(Boolean);

  const totalEl = document.querySelector("[data-test='orderTotal'], .order-total");
  const grandTotal = totalEl ? parseCurrencyToCents(totalEl.textContent) : items.reduce((s, i) => s + i.price * 100, 0);

  if (!orderDate || items.length === 0) return null;

  return {
    retailer: "target",
    orderId,
    orderDate,
    grandTotal,
    items,
  };
};

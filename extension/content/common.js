// Shared message contract between content scripts and the popup.
// Content scripts register `window.__actualItemizerExtract` with a function
// that returns a normalized order payload, or null if the page isn't recognized.

window.__actualItemizerExtract = window.__actualItemizerExtract ?? null;

function parseCurrencyToCents(text) {
  const match = text.replace(/,/g, "").match(/-?\d+(\.\d{1,2})?/);
  if (!match) return 0;
  return Math.round(parseFloat(match[0]) * 100);
}

const statusEl = document.getElementById("status");

document.getElementById("send").addEventListener("click", async () => {
  statusEl.textContent = "Extracting…";
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => window.__actualItemizerExtract?.() ?? null,
    });

    if (!result) {
      statusEl.textContent = "Couldn't find an order on this page.";
      return;
    }

    const { serverUrl, sharedSecret } = await chrome.storage.sync.get(["serverUrl", "sharedSecret"]);
    if (!serverUrl || !sharedSecret) {
      statusEl.textContent = "Set server URL and shared secret in the extension options first.";
      return;
    }

    const response = await fetch(`${serverUrl.replace(/\/$/, "")}/api/orders`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${sharedSecret}` },
      body: JSON.stringify(result),
    });

    if (response.ok) {
      statusEl.textContent = "Sent! Review it in the Actual Itemizer web UI.";
    } else {
      const body = await response.json().catch(() => ({}));
      statusEl.textContent = `Error: ${body.error ?? response.status}`;
    }
  } catch (err) {
    statusEl.textContent = `Error: ${err.message}`;
  }
});

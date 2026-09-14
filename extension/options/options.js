const serverUrlInput = document.getElementById("serverUrl");
const sharedSecretInput = document.getElementById("sharedSecret");
const statusEl = document.getElementById("status");

chrome.storage.sync.get(["serverUrl", "sharedSecret"]).then(({ serverUrl, sharedSecret }) => {
  serverUrlInput.value = serverUrl ?? "http://127.0.0.1:4000";
  sharedSecretInput.value = sharedSecret ?? "";
});

document.getElementById("save").addEventListener("click", async () => {
  await chrome.storage.sync.set({ serverUrl: serverUrlInput.value, sharedSecret: sharedSecretInput.value });
  statusEl.textContent = "Saved.";
});

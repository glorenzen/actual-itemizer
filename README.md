# Actual Itemizer

Local-first tool that splits multi-category Amazon/Target orders into properly
categorized Actual Budget split transactions, using a local LLM (via a
LocalAI-compatible endpoint) for category suggestions and a human approval
step before anything is written to Actual.

## Components

- `server/` — Node.js/TypeScript backend. Talks to `@actual-app/api` (Node-only,
  no REST API exists), calls your local LLM for category suggestions, and
  serves a small local review web UI at `http://127.0.0.1:<PORT>`.
- `extension/` — Manifest V3 browser extension. Extracts item/price data from
  an open Amazon or Target order-details page and POSTs it to the server.

Full design notes and rationale live in the project plan (see chat history /
`docs/`).

## Setup

### 1. Backend

```sh
cd server
npm install
cp .env.example .env   # fill in ACTUAL_* and LOCALAI_* values, pick a SHARED_SECRET
npm run dev
```

The server binds to `127.0.0.1` only and requires every `/api/*` request to
carry `Authorization: Bearer <SHARED_SECRET>`.

#### Connecting to a remote/HTTPS Actual server

`ACTUAL_SERVER_URL` can point at a remote `https://` server with no extra
config, as long as it has a certificate trusted by Node (e.g. Let's Encrypt).
Two things are separate from that:

- **Self-signed certs**: set `NODE_EXTRA_CA_CERTS=/path/to/cert.pem` (or, only
  if you understand the risk, `NODE_TLS_REJECT_UNAUTHORIZED=0`) as an
  environment variable for the server process — this is a Node/TLS setting,
  not something this app configures.
- **End-to-end encryption**: if the budget file itself has E2E encryption
  enabled, set `ACTUAL_E2E_PASSWORD` in `.env`. This is the file's encryption
  password, not your server login password (`ACTUAL_PASSWORD`) — without it,
  `downloadBudget` will fail to decrypt the file even over a working HTTPS
  connection.

### 2. Browser extension

1. Open your browser's extensions page and enable "load unpacked", pointing at
   the `extension/` folder.
2. Open the extension's options page and set the server URL (e.g.
   `http://127.0.0.1:4000`) and the same `SHARED_SECRET` from `server/.env`.

### 3. Usage

1. Open an Amazon or Target order-details page.
2. Click the extension icon → "Send order to Actual Itemizer".
3. Open `http://127.0.0.1:4000` in a browser, select the pending order, review
   the proposed category split, link it to the matching uncategorized
   transaction in Actual, edit anything that looks wrong, and approve.

Nothing is written to Actual until you click Approve.

## Notes on scope (v1)

- Amazon + Target only; the extension/backend payload schema is
  retailer-agnostic so more sites can be added later without backend changes.
- Multi-charge orders (one Amazon order billed across several card charges)
  are not auto-split yet — the review UI currently supports linking to a
  single transaction per order; approving against multiple linked
  transactions is a follow-up.
- DOM selectors in `extension/content/amazon.js` and `target.js` are
  best-effort and will likely need adjusting against live order pages.

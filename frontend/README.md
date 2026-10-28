# Actual Itemizer frontend

Next.js app hosting the review UI and the `/api/*` route handlers that talk to
Actual Budget (`@actual-app/api`) and the local LLM (LocalAI-compatible).

See the [root README](../README.md) for setup and usage.

```sh
npm install
cp .env.example .env   # fill in ACTUAL_*, LOCALAI_*, SHARED_SECRET
npm run dev            # http://127.0.0.1:4000
```

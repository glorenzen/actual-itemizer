import express from "express";
import cors from "cors";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { config } from "./config.js";
import { ordersRouter } from "./routes/orders.js";
import { categoriesRouter } from "./routes/categories.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

export function createServer() {
  const app = express();

  // Only the browser extension (running as a content/popup script, no fixed
  // origin) and the local review UI (same-origin, served below) talk to this
  // server. Restrict CORS and require a shared secret on every API call.
  app.use(cors({ origin: true }));
  app.use(express.json({ limit: "1mb" }));

  app.use("/api", (req, res, next) => {
    const header = req.header("authorization") ?? "";
    const token = header.startsWith("Bearer ") ? header.slice("Bearer ".length) : "";
    if (token !== config.server.sharedSecret) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    next();
  });

  app.use("/api/orders", ordersRouter);
  app.use("/api/categories", categoriesRouter);

  app.use(express.static(join(__dirname, "..", "public")));

  return app;
}

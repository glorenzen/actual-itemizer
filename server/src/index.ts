import { config } from "./config.js";
import { createServer } from "./server.js";
import { initActual, shutdownActual } from "./actual.js";

async function main() {
  await initActual();

  const app = createServer();
  const server = app.listen(config.server.port, "127.0.0.1", () => {
    console.log(`actual-itemizer server listening on http://127.0.0.1:${config.server.port}`);
  });

  const shutdown = async () => {
    server.close();
    await shutdownActual();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

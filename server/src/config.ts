import "dotenv/config";

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const config = {
  actual: {
    serverURL: required("ACTUAL_SERVER_URL"),
    password: required("ACTUAL_PASSWORD"),
    syncId: required("ACTUAL_SYNC_ID"),
    dataDir: process.env.ACTUAL_DATA_DIR ?? "./.actual-cache",
  },
  localai: {
    baseURL: required("LOCALAI_BASE_URL"),
    model: process.env.LOCALAI_MODEL ?? "qwen2.5",
  },
  server: {
    port: Number(process.env.PORT ?? 4000),
    sharedSecret: required("SHARED_SECRET"),
  },
  db: {
    path: process.env.DB_PATH ?? "./data/orders.sqlite",
  },
};

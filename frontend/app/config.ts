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
    // Only needed if the budget file has end-to-end encryption enabled;
    // this is separate from the server login password above.
    e2ePassword: process.env.ACTUAL_E2E_PASSWORD || undefined,
  },
  localai: {
    baseURL: required("LOCALAI_BASE_URL"),
    model: process.env.LOCALAI_MODEL ?? "qwen2.5",
    // Relative to the frontend/ working directory.
    examplesPath: process.env.CATEGORY_EXAMPLES_PATH ?? "../data/category-examples.json",
  },
  server: {
    port: Number(process.env.PORT ?? 4000),
    sharedSecret: required("SHARED_SECRET"),
    taxRatePercent: Number(process.env.TAX_RATE_PERCENT ?? 0),
  },
  db: {
    path: process.env.DB_PATH ?? "./data/orders.sqlite",
  },
};

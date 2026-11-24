import { defineConfig, defineWorker, exports } from "cf/config";
import * as entrypoint from "./src/server/index.ts" with { type: "cf-worker" };

export default defineConfig({
  worker: defineWorker({
    name: "funyaoji",
    compatibilityDate: "2026-11-20",
    entrypoint,
    assets: { runWorkerFirst: ["/api/*"] },
    exports: { Room: exports.durableObject({ storage: "sqlite" }) },
    // 呼び出しのログは切り、サーバーが console.log で書いた出来事と例外だけを残す（設計の「ログ」）
    observability: { enabled: true, logs: { invocationLogs: false } },
  }),
});

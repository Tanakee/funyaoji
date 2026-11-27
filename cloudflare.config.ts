import { bindings, defineConfig, defineWorker, exports } from "cf/config";
import * as entrypoint from "./src/server/index.ts" with { type: "cf-worker" };

export default defineConfig({
  worker: defineWorker({
    name: "funyaoji",
    compatibilityDate: "2026-11-20",
    entrypoint,
    assets: { runWorkerFirst: ["/api/*"] },
    exports: {
      Room: exports.durableObject({ storage: "sqlite" }),
      RoomGate: exports.durableObject({ storage: "sqlite" }),
    },
    env: {
      // POST /api/rooms を IP ごとに1分に10回まで（設計の「ルームを作る API の乱用」）。
      // namespace はアカウントの中で重ならない整数。ロケーションごとに数えるので、厳密ではない
      ROOM_RATE_LIMIT: bindings.rateLimit({ namespace: "1001", simple: { limit: 10, period: 60 } }),
    },
    // 呼び出しのログは切り、サーバーが console.log で書いた出来事と例外だけを残す（設計の「ログ」）
    observability: { enabled: true, logs: { invocationLogs: false } },
  }),
});

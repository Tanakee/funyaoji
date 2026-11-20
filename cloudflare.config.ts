import { bindings, defineConfig, defineWorker, exports } from "cf/config";
import * as entrypoint from "./src/server/index.ts" with { type: "cf-worker" };

const worker = defineWorker({
  name: "funyaoji",
  compatibilityDate: "2026-11-20",
  entrypoint,
  assets: { runWorkerFirst: ["/api/*"] },
  exports: { Room: exports.durableObject({ storage: "sqlite" }) },
});

// バインディングの worker に名前（文字列）を渡すと、stub に型が付かない。Worker の定義を渡すと、Room のメソッドに型が付く
export default defineConfig({
  worker: {
    ...worker,
    env: { ROOMS: bindings.durableObject({ worker, exportName: "Room" }) },
  },
});

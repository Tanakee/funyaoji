// サーバーのテスト用の開発サーバー。src/server/test-setup.ts が別のプロセスで動かす
// （vp test のプロセスの中では、Worker の設定を読み込めないため）。
// 空いているポートを使い、Durable Object の状態はファイルに残さない。立てたら URL を1行出力する
import { cloudflare } from "@cloudflare/vite-plugin";
import { createServer } from "vite-plus";

const server = await createServer({
  configFile: false,
  // npm run dev の開発サーバーと同時に動かしても、依存のキャッシュを消し合わないように分ける
  cacheDir: "node_modules/.vite-test",
  logLevel: "error",
  clearScreen: false,
  plugins: [cloudflare({ persistState: false, inspectorPort: false, types: { generate: false } })],
  server: { host: "127.0.0.1", port: 0 },
});
await server.listen();

const address = server.httpServer?.address();
if (address === null || address === undefined || typeof address === "string") {
  await server.close();
  throw new Error("開発サーバーのポートが分かりません");
}
console.log(`http://127.0.0.1:${address.port}`);

// 親のプロセスが終わったら、止める
async function stop(): Promise<void> {
  await server.close();
  process.exit(0);
}
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
process.stdin.on("end", stop);
process.stdin.resume();

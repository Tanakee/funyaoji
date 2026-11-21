import { spawn } from "node:child_process";
import { once } from "node:events";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import type { TestProject } from "vite-plus/test/node";
// テストに渡す値の型（ProvidedContext）
import type {} from "./test-context.d.ts";

/** 開発サーバーが立つまで待つ時間 */
const START_TIMEOUT = 30_000;
/** SIGTERM で止まらないときに、SIGKILL を送るまで待つ時間 */
const STOP_TIMEOUT = 5_000;
/** test-server.ts が出力する URL の形。ほかの行は読み飛ばす */
const URL_PATTERN = /^http:\/\/127\.0\.0\.1:\d+$/;

/**
 * vp test の globalSetup。サーバーのテストのために、src/server/test-server.ts を別のプロセスで動かし、
 * その URL をテストに渡す。テストが終わったら止める
 */
export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  const script = fileURLToPath(new URL("test-server.ts", import.meta.url));
  const child = spawn(process.execPath, [script], {
    cwd: project.config.root,
    // stdin を閉じると止まる。vp test が落ちても残らない
    stdio: ["pipe", "pipe", "inherit"],
  });
  const exited = once(child, "exit");
  const stop = async () => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    child.kill("SIGTERM");
    // 止まらなければ SIGKILL を送り、vp test が終わらなくならないようにする
    const killTimer = setTimeout(() => child.kill("SIGKILL"), STOP_TIMEOUT);
    await exited;
    clearTimeout(killTimer);
  };

  let timer: NodeJS.Timeout | undefined;
  try {
    const lines = createInterface({ input: child.stdout });
    const url = await Promise.race([
      new Promise<string>((resolve) => {
        lines.on("line", (line) => {
          if (URL_PATTERN.test(line)) resolve(line);
        });
      }),
      exited.then(() => Promise.reject(new Error("開発サーバーが起動できませんでした"))),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("開発サーバーが時間内に起動しませんでした")),
          START_TIMEOUT,
        );
      }),
    ]);
    // 最初のテストが、開発サーバーの初回の変換を待って遅くならないように、一度呼んでおく
    await (await fetch(`${url}/api/ping`)).text();
    project.provide("serverUrl", url);
  } catch (error) {
    await stop();
    throw error;
  } finally {
    clearTimeout(timer);
  }
  return stop;
}

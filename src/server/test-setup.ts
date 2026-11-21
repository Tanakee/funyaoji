/// <reference types="node" />
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import type { TestProject } from "vite-plus/test/node";

declare module "vitest" {
  export interface ProvidedContext {
    /** テスト用に立てた開発サーバーの URL（例：http://127.0.0.1:51234） */
    serverUrl: string;
  }
}

/** 開発サーバーが立つまで待つ時間 */
const START_TIMEOUT = 30_000;

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
    await exited;
  };

  let timer: NodeJS.Timeout | undefined;
  try {
    const lines = createInterface({ input: child.stdout });
    const url = await Promise.race([
      once(lines, "line").then(([line]: string[]) => line!),
      exited.then(() => Promise.reject(new Error("開発サーバーが起動できませんでした"))),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("開発サーバーが時間内に起動しませんでした")),
          START_TIMEOUT,
        );
      }),
    ]);
    project.provide("serverUrl", url);
  } catch (error) {
    await stop();
    throw error;
  } finally {
    clearTimeout(timer);
  }
  return stop;
}

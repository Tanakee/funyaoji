// src/server/test-setup.ts がテストに渡す値の型
declare module "vitest" {
  export interface ProvidedContext {
    /** テスト用に立てた開発サーバーの URL（例：http://127.0.0.1:51234） */
    serverUrl: string;
  }
}
export {};

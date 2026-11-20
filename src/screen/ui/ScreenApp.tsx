import { useEffect, useState } from "react";
import { fetchPing } from "../../net/api.ts";

type PingState =
  | { status: "loading" }
  | { status: "ready"; count: number }
  | { status: "error"; message: string };

export function ScreenApp() {
  const [ping, setPing] = useState<PingState>({ status: "loading" });

  useEffect(() => {
    fetchPing().then(
      ({ count }) => setPing({ status: "ready", count }),
      (error: unknown) =>
        setPing({
          status: "error",
          message: error instanceof Error ? error.message : String(error),
        }),
    );
  }, []);

  return (
    <>
      <h1>スクリーンのページ</h1>
      <p>
        {ping.status === "loading" && "サーバーに問い合わせ中"}
        {ping.status === "ready" && `サーバーを ${ping.count} 回呼びました`}
        {ping.status === "error" && `サーバーに接続できません（${ping.message}）`}
      </p>
    </>
  );
}

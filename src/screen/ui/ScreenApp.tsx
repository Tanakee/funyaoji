import { useEffect, useState } from "react";
import type { PingResponse } from "../../shared/api.ts";

type PingState =
  | { status: "loading" }
  | { status: "ready"; count: number }
  | { status: "error"; message: string };

export function ScreenApp({ ping }: { ping: Promise<PingResponse> }) {
  const [state, setState] = useState<PingState>({ status: "loading" });

  useEffect(() => {
    ping.then(
      ({ count }) => setState({ status: "ready", count }),
      (error: unknown) =>
        setState({
          status: "error",
          message: error instanceof Error ? error.message : String(error),
        }),
    );
  }, [ping]);

  return (
    <>
      <h1>スクリーンのページ</h1>
      <p>
        {state.status === "loading" && "サーバーに問い合わせ中"}
        {state.status === "ready" && `サーバーを ${state.count} 回呼びました`}
        {state.status === "error" && `サーバーに接続できません（${state.message}）`}
      </p>
    </>
  );
}

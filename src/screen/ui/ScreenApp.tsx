import { Suspense, use } from "react";

export type PingResult = { ok: true; count: number } | { ok: false; message: string };

export function ScreenApp({ ping }: { ping: Promise<PingResult> }) {
  return (
    <>
      <h1>スクリーンのページ</h1>
      <p>
        <Suspense fallback="サーバーに問い合わせ中">
          <PingText ping={ping} />
        </Suspense>
      </p>
    </>
  );
}

function PingText({ ping }: { ping: Promise<PingResult> }) {
  const result = use(ping);
  return result.ok
    ? `サーバーを ${result.count} 回呼びました`
    : `サーバーに接続できません（${result.message}）`;
}

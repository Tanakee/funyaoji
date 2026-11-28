import type { ScreenView } from "./session.ts";

/** プレイ中・カウントダウン中の、やり直しのキー。動けなくなったときのために、いつでも出しておく */
export function RestartHint({ view }: { view: ScreenView }) {
  const { kind } = view.flow;
  if (kind !== "countdown" && kind !== "playing" && kind !== "finish") return null;
  return (
    <p className="restart-hint">
      <kbd>R</kbd>やり直す
    </p>
  );
}

import type { ScreenView } from "./session.ts";

/** プレイ中・カウントダウン中の、やり直しのキー。動けなくなったときのために、いつでも出しておく */
export function RestartHint({ view }: { view: ScreenView }) {
  if (view.flow.kind !== "countdown" && view.flow.kind !== "playing") return null;
  return (
    <p className="restart-hint">
      動けなくなったら <kbd>Space</kbd> か <kbd>R</kbd> でやり直す
    </p>
  );
}

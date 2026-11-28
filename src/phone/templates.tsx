// スマホの2つのひな形（docs/screens.md の「待つ型」「お知らせ型」）。使う画面ごとに、文言だけを変える
import type { ReactNode } from "react";
import { HANGING_OJISAN, SITTING_OJISAN } from "../shared/figures.tsx";

/** ゆるんだ糸の持ち手（P5a）。スクリーンで、切れた人の持ち手が灰色の点線になるのと同じ見た目 */
const SLACK_HANDLE = (
  <svg className="figure-svg" viewBox="0 0 120 170" aria-hidden="true">
    <rect x="24" y="4" width="72" height="80" rx="14" className="figure-handle" />
    <path d="M60 84 C 66 112, 48 128, 58 166" className="figure-slack" />
  </svg>
);

/**
 * 待つ型。見出しと、待つ長さが分かるときは残り秒数（children）を出す。
 * 絵は揺れ続け、固まっていないことを文字を読まずに分からせる
 */
export function Waiting({
  title,
  figure = "ojisan",
  children,
}: {
  title: string;
  /** ojisan：吊られたおじさん。handle：ゆるんだ糸の持ち手（つなぎ直し中） */
  figure?: "ojisan" | "handle";
  children?: ReactNode;
}) {
  return (
    <div className="waiting">
      <div className="figure figure-swing">
        {figure === "handle" ? SLACK_HANDLE : HANGING_OJISAN}
      </div>
      <h1 className="waiting-title">{title}</h1>
      {children}
    </div>
  );
}

/** お知らせ型。見出し・理由・次にすることの3つ。ボタンを置くときは children に渡す */
export function Notice({
  title,
  reason,
  next,
  children,
}: {
  title: string;
  reason?: string;
  next?: string;
  children?: ReactNode;
}) {
  return (
    <div className="notice" role="alert">
      <div className="figure">{SITTING_OJISAN}</div>
      <h1 className="notice-title">{title}</h1>
      {reason !== undefined ? <p className="notice-reason">{reason}</p> : null}
      {next !== undefined ? <p className="notice-next">{next}</p> : null}
      {children}
    </div>
  );
}

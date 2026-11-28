// スマホの2つのひな形（docs/screens.md の「待つ型」「お知らせ型」）。使う画面ごとに、文言だけを変える
import type { ReactNode } from "react";

/** 糸に吊られたおじさん。灰色の形だけ。揺らすのは外側の div（SVG を直接動かすより軽い） */
const HANGING_OJISAN = (
  <svg className="figure-svg" viewBox="0 0 120 170" aria-hidden="true">
    <path d="M40 0 V58 M80 0 V58" className="figure-string" />
    <circle cx="60" cy="40" r="20" className="figure-body" />
    <rect x="38" y="62" width="44" height="56" rx="18" className="figure-body" />
    <path d="M48 116 L44 160 M72 116 L76 160" className="figure-limb" />
  </svg>
);

/** ゆるんだ糸の持ち手（P5a）。スクリーンで、切れた人の持ち手が灰色の点線になるのと同じ見た目 */
const SLACK_HANDLE = (
  <svg className="figure-svg" viewBox="0 0 120 170" aria-hidden="true">
    <rect x="24" y="4" width="72" height="80" rx="14" className="figure-handle" />
    <path d="M60 84 C 66 112, 48 128, 58 166" className="figure-slack" />
  </svg>
);

/** 糸が切れて座り込んだおじさん（お知らせ型）。灰色の形だけ */
const SITTING_OJISAN = (
  <svg className="figure-svg figure-sitting" viewBox="0 0 200 120" aria-hidden="true">
    <path d="M40 0 L44 40 M90 0 L88 26 M140 0 L134 34" className="figure-string" />
    <circle cx="70" cy="34" r="18" className="figure-body" />
    <ellipse cx="62" cy="80" rx="24" ry="30" className="figure-body" />
    <path d="M70 104 L120 100 L160 108" className="figure-limb" />
    <line x1="10" y1="114" x2="190" y2="114" className="figure-ground" />
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

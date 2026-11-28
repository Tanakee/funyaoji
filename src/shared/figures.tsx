// 待つ型とお知らせ型の絵。スマホとスクリーンで共有し、色と大きさは各画面の CSS の .figure-* で決める
/** 糸に吊られたおじさん。灰色の形だけ。揺らすのは外側の div（SVG を直接動かすより軽い） */
export const HANGING_OJISAN = (
  <svg className="figure-svg" viewBox="0 0 120 170" aria-hidden="true">
    <path d="M40 0 V58 M80 0 V58" className="figure-string" />
    <circle cx="60" cy="40" r="20" className="figure-body" />
    <rect x="38" y="62" width="44" height="56" rx="18" className="figure-body" />
    <path d="M48 116 L44 160 M72 116 L76 160" className="figure-limb" />
  </svg>
);

/** 糸が切れて座り込んだおじさん（お知らせ型）。灰色の形だけ */
export const SITTING_OJISAN = (
  <svg className="figure-svg figure-sitting" viewBox="0 0 200 120" aria-hidden="true">
    <path d="M40 0 L44 40 M90 0 L88 26 M140 0 L134 34" className="figure-string" />
    <circle cx="70" cy="34" r="18" className="figure-body" />
    <ellipse cx="62" cy="80" rx="24" ry="30" className="figure-body" />
    <path d="M70 104 L120 100 L160 108" className="figure-limb" />
    <line x1="10" y1="114" x2="190" y2="114" className="figure-ground" />
  </svg>
);

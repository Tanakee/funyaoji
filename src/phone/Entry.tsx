import { needsTiltPermission } from "./tilt.ts";

const HANGING_OJISAN = (
  <svg className="entry-figure" viewBox="0 0 240 340" aria-hidden="true">
    <path className="figure-string" d="M16 10 H224" />
    <path className="figure-ground" d="M16 330 H224" />
    <path className="figure-limb" d="M107 209 L91 270 L94 322" />
    <ellipse className="figure-body" cx="112" cy="166" rx="38" ry="52" />
    <circle className="figure-body" cx="127" cy="88" r="27" />
    <path className="figure-limb" d="M122 143 L140 192 M127 207 L164 252 L169 321" />
    <path
      className="figure-string"
      d="M32 24 Q32 165 94 322 M77 24 Q63 144 98 265
      M163 24 Q187 133 168 248 M208 24 Q210 181 169 321"
    />
    <g className="figure-body">
      <rect x="20" y="6" width="24" height="18" rx="4" />
      <rect x="65" y="6" width="24" height="18" rx="4" />
      <rect x="151" y="6" width="24" height="18" rx="4" />
      <rect x="196" y="6" width="24" height="18" rx="4" />
      <circle cx="94" cy="322" r="6" />
      <circle cx="98" cy="265" r="6" />
      <circle cx="168" cy="248" r="6" />
      <circle cx="169" cy="321" r="6" />
    </g>
  </svg>
);

export function Entry({
  askingPermission,
  onJoin,
}: {
  askingPermission: boolean;
  onJoin: () => void;
}) {
  return (
    <section className="entry phone-content" aria-label="参加前">
      {HANGING_OJISAN}
      <p className="entry-description">
        4人でスマホを傾けて、
        <br />
        おじさんを歩かせよう
      </p>
      <div className="entry-actions">
        {needsTiltPermission() ? (
          <p className="entry-permission">次に出る確認で「許可」を押して</p>
        ) : null}
        <button className="big-button" type="button" onClick={onJoin} disabled={askingPermission}>
          参加する
        </button>
      </div>
    </section>
  );
}

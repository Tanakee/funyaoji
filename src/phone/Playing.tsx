import { useRef, type CSSProperties } from "react";
import type { Joint } from "../shared/messages.ts";
import { JointBand } from "./JointBand.tsx";
import { JOINT_LABELS } from "./joints.ts";
import { MAX_ANGLE } from "./tilt.ts";
import { useTiltFrame } from "./useTiltFrame.ts";

const STRING_X = 231;
const ATTACH_Y = 525;
const SCALE_TOP = 55;
const SCALE_BOTTOM = 390;
const SLACK_BEND = 84;

/** 糸は、上の端から付け所までの2次ベジェ曲線。たるむほど、中ほどの制御点を右へずらす */
function stringPath(bend: number): string {
  return `M${STRING_X} 0 Q${(STRING_X + bend).toFixed(1)} ${ATTACH_Y / 2} ${STRING_X} ${ATTACH_Y}`;
}

/** 高さ y での糸の横位置。結び玉を、たるんだ糸の上に載せる。この曲線は y が媒介変数に比例する */
function stringX(y: number, bend: number): number {
  const t = y / ATTACH_Y;
  return STRING_X + 2 * (1 - t) * t * bend;
}

const SCALE = (
  <g className="playing-scale">
    <path d="M154 55 V390 M142 55 H166 M147 166.7 H161 M147 278.3 H161 M142 390 H166" />
    <text x="132" y="51">
      立てる
      <tspan x="132" dy="20">
        90度
      </tspan>
    </text>
    <text x="132" y="386">
      寝かせる
      <tspan x="132" dy="20">
        0度
      </tspan>
    </text>
  </g>
);

export function Playing({ joint, active }: { joint: Joint; active: boolean }) {
  const label = JOINT_LABELS[joint];
  const string = useRef<SVGPathElement>(null);
  const knot = useRef<SVGGElement>(null);
  const tick = useRef<SVGLineElement>(null);

  useTiltFrame((angle = 0) => {
    const tension = angle / MAX_ANGLE;
    const bend = (1 - tension) * SLACK_BEND;
    const y = SCALE_BOTTOM - tension * (SCALE_BOTTOM - SCALE_TOP);
    const x = stringX(y, bend).toFixed(1);
    const knotY = y.toFixed(1);
    const rope = string.current!;
    rope.setAttribute("d", stringPath(bend));
    rope.setAttribute("stroke-width", (3 + tension * 6).toFixed(1));
    rope.setAttribute("opacity", (0.55 + tension * 0.45).toFixed(2));
    knot.current!.setAttribute("transform", `translate(${x} ${knotY})`);
    const marker = tick.current!;
    marker.setAttribute("y1", knotY);
    marker.setAttribute("y2", knotY);
    marker.setAttribute("x2", x);
  });

  return (
    <>
      <JointBand joint={joint} />
      <section
        className="playing phone-content"
        style={{ "--joint": label.color } as CSSProperties}
      >
        <svg
          className="playing-diagram"
          viewBox="0 0 320 608"
          preserveAspectRatio="xMidYMin meet"
          role="img"
          aria-label="担当の糸と傾きの目盛り。立てると90度、寝かせると0度"
        >
          {SCALE}
          <path
            className="playing-leg-faint"
            d={label.hip ? "M222 528 L196 583" : "M93 439 L170 474"}
          />
          <path
            className="playing-leg"
            d={label.hip ? "M100 463 L221 533" : "M170 474 L225 535 H260"}
          />
          <line className="playing-marker" x1="154" ref={tick} />
          <path className="playing-string" ref={string} />
          <circle className="playing-attachment" cx={STRING_X} cy={ATTACH_Y} r="10" />
          <g ref={knot}>
            <circle className="playing-glow" r="28" />
            <circle className="playing-knot" r="18" />
          </g>
        </svg>
        <p className={active ? "playing-hint" : "playing-hint playing-warning"}>
          {active ? "スクリーンを見て傾けよう" : "傾きがスクリーンに届いていません"}
        </p>
      </section>
    </>
  );
}

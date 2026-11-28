import { useLayoutEffect, useRef, type CSSProperties } from "react";
import type { Joint } from "../shared/messages.ts";
import { JointBand } from "./JointBand.tsx";
import { JOINT_LABELS } from "./joints.ts";
import { latestAngle, MAX_ANGLE } from "./tilt.ts";

const STRING_X = 231;
const ATTACH_Y = 525;
const SCALE_TOP = 55;
const SCALE_BOTTOM = 390;
const SLACK_BEND = 84;

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
  const thigh = joint === "rightHip" || joint === "leftHip";
  const string = useRef<SVGPathElement>(null);
  const knot = useRef<SVGGElement>(null);
  const tick = useRef<SVGLineElement>(null);

  useLayoutEffect(() => {
    const rope = string.current!;
    const ball = knot.current!;
    const marker = tick.current!;
    let frame = 0;
    let drawn: number | undefined;

    const draw = () => {
      frame = requestAnimationFrame(draw);
      const angle = latestAngle() ?? 0;
      if (angle === drawn) return;
      drawn = angle;
      const tension = angle / MAX_ANGLE;
      const bend = (1 - tension) * SLACK_BEND;
      const y = SCALE_BOTTOM - tension * (SCALE_BOTTOM - SCALE_TOP);
      // 結び玉の横位置を糸の曲線に合わせ、緩んでも糸の上に見えるようにする
      const t = y / ATTACH_Y;
      const x = (STRING_X + 2 * (1 - t) * t * bend).toFixed(1);
      const knotY = y.toFixed(1);

      rope.setAttribute(
        "d",
        `M${STRING_X} 0 Q${(STRING_X + bend).toFixed(1)} ${ATTACH_Y / 2} ${STRING_X} ${ATTACH_Y}`,
      );
      rope.setAttribute("stroke-width", (3 + tension * 6).toFixed(1));
      rope.setAttribute("opacity", (0.55 + tension * 0.45).toFixed(2));
      ball.setAttribute("transform", `translate(${x} ${knotY})`);
      marker.setAttribute("y1", knotY);
      marker.setAttribute("y2", knotY);
      marker.setAttribute("x2", x);
    };

    draw();
    return () => cancelAnimationFrame(frame);
  }, []);

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
            d={thigh ? "M222 528 L196 583" : "M93 439 L170 474"}
          />
          <path
            className="playing-leg"
            d={thigh ? "M100 463 L221 533" : "M170 474 L225 535 H260"}
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

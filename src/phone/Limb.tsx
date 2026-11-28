import { useEffect, useRef } from "react";
import { JOINT_SPECS, PART_SHAPES, type ShapeSpec } from "../screen/game/body.ts";
import { tiltToInput } from "../screen/game/types.ts";
import { jointCssColor } from "../shared/joints.ts";
import type { Joint } from "../shared/messages.ts";
import { latestAngle } from "./tilt.ts";

/**
 * 担当の脚を、いまの傾きの角度で描く。スマホの中だけで描くので、傾けたらすぐ動く。
 * 描くのはスクリーンの関節の目標の角度（入力 0〜1 を JOINT_SPECS の range に当てたもの）で、
 * 物理で追いかけたあとの脚ではない。おじさんの脚はこの形を目指して、あとから動く。
 * tilt は毎秒60回ほど変わるので、React の state は使わず、毎フレーム DOM を直接書き換える
 */
export function Limb({ joint }: { joint: Joint }) {
  const root = useRef<HTMLDivElement>(null);
  const moving = useRef<SVGGElement>(null);
  const degrees = useRef<HTMLSpanElement>(null);
  const isHip = joint.endsWith("Hip");
  const [lo, hi] = JOINT_SPECS[joint].range;

  useEffect(() => {
    let frame = 0;
    /** 最後に描いた角度。null は、まだ何も描いていない */
    let drawn: number | undefined | null = null;
    const draw = () => {
      frame = requestAnimationFrame(draw);
      const angle = latestAngle();
      if (angle === drawn) return;
      drawn = angle;
      root.current!.dataset.empty = String(angle === undefined);
      degrees.current!.textContent = angle === undefined ? "--" : String(Math.round(angle));
      const rad = lo + (hi - lo) * tiltToInput(angle ?? 0);
      moving.current!.setAttribute("transform", rotate(rad));
    };
    draw();
    return () => cancelAnimationFrame(frame);
  }, [lo, hi]);

  const color = jointCssColor(joint);
  // 股関節なら、もも（とその先のすね）が回る。ひざなら、ももは動かさず、すねだけが回る
  const shinAt = `translate(0 ${THIGH_LENGTH})`;
  /** 動ける範囲の端の形。動く部位だけを描く */
  const ghost = (rad: number) =>
    isHip ? (
      <g className="limb-ghost" transform={rotate(rad)}>
        <Thigh color={color} />
        <g transform={shinAt}>
          <Shin />
        </g>
      </g>
    ) : (
      <g transform={shinAt}>
        <g className="limb-ghost" transform={rotate(rad)}>
          <Shin color={color} />
        </g>
      </g>
    );

  return (
    <div className="limb" ref={root} data-empty="true">
      <svg className="limb-figure" viewBox="-170 -80 420 330" aria-hidden="true">
        {/* 胴の下の端。顔は右（進む向き）を向いている */}
        <rect className="limb-torso" x={-28} y={-70} width={56} height={70} rx={14} />
        {/* 動ける範囲の両端を、うっすら描く */}
        {ghost(lo)}
        {ghost(hi)}
        {isHip ? (
          <g ref={moving}>
            <Thigh color={color} />
            <g transform={shinAt}>
              <Shin />
            </g>
          </g>
        ) : (
          <>
            <Thigh />
            <g transform={shinAt}>
              <g ref={moving}>
                <Shin color={color} />
              </g>
            </g>
          </>
        )}
        <circle className="limb-pivot" cx={0} cy={isHip ? 0 : THIGH_LENGTH} r={9} fill={color} />
      </svg>
      <p className="limb-readout">
        <span ref={degrees}>--</span>°
      </p>
      <p className="limb-empty">傾きが読み取れていません</p>
    </div>
  );
}

/** 1m を何 px で描くか */
const SCALE = 240;
const box = (shape: ShapeSpec) => (shape.kind === "box" ? shape : undefined);
const thighShape = box(PART_SHAPES.rightThigh[0]!)!;
const shinShape = box(PART_SHAPES.rightShin.find((s) => s.tag === "limb")!)!;
const footShape = box(PART_SHAPES.rightShin.find((s) => s.tag === "foot")!)!;
const THIGH_LENGTH = thighShape.hh * 2 * SCALE;
const SHIN_LENGTH = shinShape.hh * 2 * SCALE;

/**
 * 物理の角度（rad。反時計回りが +、上が +y）を、SVG の rotate（度。時計回りが +、下が +y）に直す。
 * 脚は下に垂れていて、+ に回すと足先が前（右）に出る
 */
function rotate(rad: number): string {
  return `rotate(${(-rad * 180) / Math.PI})`;
}

/** もも。股関節（原点）から下に伸びる。color が無ければ、動かない部位の色 */
function Thigh({ color }: { color?: string }) {
  const w = thighShape.hw * 2 * SCALE;
  return (
    <rect
      className="limb-part"
      x={-w / 2}
      y={0}
      width={w}
      height={THIGH_LENGTH}
      rx={w / 2}
      style={color ? { fill: color } : undefined}
    />
  );
}

/** すねと足。ひざ（原点）から下に伸びる。足はすねに固定され、スクリーンと同じく後ろにずれている */
function Shin({ color }: { color?: string }) {
  const w = shinShape.hw * 2 * SCALE;
  const footW = footShape.hw * 2 * SCALE;
  const footH = footShape.hh * 2 * SCALE;
  return (
    <>
      <rect
        className="limb-part"
        x={-w / 2}
        y={0}
        width={w}
        height={SHIN_LENGTH}
        rx={w / 2}
        style={color ? { fill: color } : undefined}
      />
      <rect
        className="limb-foot"
        x={footShape.ox * SCALE - footW / 2}
        y={SHIN_LENGTH}
        width={footW}
        height={footH}
        rx={footH / 2}
      />
    </>
  );
}

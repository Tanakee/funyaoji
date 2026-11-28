// おじさんの体の形・重さ・モーターの強さ。物理（sim.ts）と描画（view.ts）が同じ表を読む。DOM にも PixiJS にも依存しない
// 試作（Tanakee/funyaoji の #55）で一番歩きやすかった体「B」だけを持つ
import type { Joint } from "../../shared/messages.ts";
import type { JointInputs } from "./types.ts";

export const PART_NAMES = ["torso", "rightThigh", "rightShin", "leftThigh", "leftShin"] as const;
export type PartName = (typeof PART_NAMES)[number];

/** 描画の色分けに使う。head は胴の一部だが、色を分けたい */
export type ShapeTag = "torso" | "head" | "limb" | "foot";

/** 部位の中の形。座標は部位の中心から（m、上が +y）。半分の幅 hw・半分の高さ hh・半径 r */
export type ShapeSpec = { tag: ShapeTag; density: number; friction: number } & (
  | { kind: "box"; ox: number; oy: number; hw: number; hh: number }
  | { kind: "ball"; ox: number; oy: number; r: number }
);

/** 部位の位置と傾き。x は進む向きが +、rot は反時計回りが + */
export interface Pose {
  x: number;
  y: number;
  rot: number;
}

const TORSO = { hw: 0.24, hh: 0.373, density: 33 };
const HEAD = { r: 0.12, density: 34 };
const THIGH = { hw: 0.07, hh: 0.241, density: 143 };
const SHIN = { hw: 0.06, hh: 0.194, density: 66 };
// 足はすねに固定する（足首は動かない）。offset は、すねの中心からの前後のずれ
const FOOT = { hw: 0.22, hh: 0.04, density: 300, offset: -0.1 };

const kneeFront = { x: THIGH.hw, y: -THIGH.hh };
const heel = { x: FOOT.offset - FOOT.hw, y: -SHIN.hh - FOOT.hh };

export const STRING_ANCHORS: Record<Joint, { part: PartName; x: number; y: number }> = {
  leftKnee: { part: "leftShin", ...heel },
  leftHip: { part: "leftThigh", ...kneeFront },
  rightKnee: { part: "rightShin", ...heel },
  rightHip: { part: "rightThigh", ...kneeFront },
};

const LIMB_FRICTION = 0.2;
export const FOOT_FRICTION = 1.845;

/** 股の高さ。足の裏が地面（y = 0）に着く */
const HIP_Y = THIGH.hh * 2 + SHIN.hh * 2 + FOOT.hh * 2;

const thighShapes: ShapeSpec[] = [
  { tag: "limb", kind: "box", ox: 0, oy: 0, ...THIGH, friction: LIMB_FRICTION },
];
const shinShapes: ShapeSpec[] = [
  { tag: "limb", kind: "box", ox: 0, oy: 0, ...SHIN, friction: LIMB_FRICTION },
  {
    tag: "foot",
    kind: "box",
    ox: FOOT.offset,
    oy: -SHIN.hh - FOOT.hh,
    ...FOOT,
    friction: FOOT_FRICTION,
  },
];

export const PART_SHAPES: Record<PartName, ShapeSpec[]> = {
  torso: [
    { tag: "torso", kind: "box", ox: 0, oy: 0, ...TORSO, friction: LIMB_FRICTION },
    {
      tag: "head",
      kind: "ball",
      ox: 0,
      oy: TORSO.hh + HEAD.r,
      r: HEAD.r,
      density: HEAD.density,
      friction: LIMB_FRICTION,
    },
  ],
  rightThigh: thighShapes,
  rightShin: shinShapes,
  leftThigh: thighShapes,
  leftShin: shinShapes,
};

/** スタートラインに立った姿勢。真っすぐ立ち、胴の中心がスタートライン（x = 0）の上 */
export const INITIAL_POSES: Record<PartName, Pose> = {
  torso: { x: 0, y: HIP_Y + TORSO.hh, rot: 0 },
  rightThigh: { x: 0, y: HIP_Y - THIGH.hh, rot: 0 },
  rightShin: { x: 0, y: HIP_Y - THIGH.hh * 2 - SHIN.hh, rot: 0 },
  leftThigh: { x: 0, y: HIP_Y - THIGH.hh, rot: 0 },
  leftShin: { x: 0, y: HIP_Y - THIGH.hh * 2 - SHIN.hh, rot: 0 },
};

/** 関節。親の部位の anchor（親の中心から）と、子の部位の anchor（子の中心から）でつなぐ */
export interface JointSpec {
  parent: PartName;
  child: PartName;
  parentAnchor: { x: number; y: number };
  childAnchor: { x: number; y: number };
  /** 角度の範囲（rad）。入力 0 が range[0]、1 が range[1] */
  range: [number, number];
}

// 股関節は 0 が後ろ・1 が前。ひざは 0 が伸ばした・1 が曲げた
const HIP_RANGE: [number, number] = [-0.6, 1.4];
const KNEE_RANGE: [number, number] = [0, -1.649];
const hip = (child: PartName): JointSpec => ({
  parent: "torso",
  child,
  parentAnchor: { x: 0, y: -TORSO.hh },
  childAnchor: { x: 0, y: THIGH.hh },
  range: HIP_RANGE,
});
const knee = (parent: PartName, child: PartName): JointSpec => ({
  parent,
  child,
  parentAnchor: { x: 0, y: -THIGH.hh },
  childAnchor: { x: 0, y: SHIN.hh },
  range: KNEE_RANGE,
});

export const JOINT_SPECS: Record<Joint, JointSpec> = {
  rightHip: hip("rightThigh"),
  leftHip: hip("leftThigh"),
  rightKnee: knee("rightThigh", "rightShin"),
  leftKnee: knee("leftThigh", "leftShin"),
};

/** 操作しないときの入力。ももが真っすぐ下を向き、ひざが伸びた、立った姿勢になる */
export const NEUTRAL_INPUTS: Readonly<JointInputs> = {
  rightHip: 0.3,
  leftHip: 0.3,
  rightKnee: 0,
  leftKnee: 0,
};

/** 目標角度のモーター */
export const MOTOR = {
  stiffness: 780,
  damping: 108,
  /** 出せる力の上限。体重の何倍のトルクか */
  maxForceBodyWeights: 0.185,
};

/** 胴を起こす補助の強さ（胴が傾いたら戻すトルク） */
export const TORSO_ASSIST = 1.006;

/** 物理の 1 ステップ（秒）。細かく刻むほど、強いモーターでも振動しにくい */
export const STEP_S = 1 / 240;

/** 胴と頭が地面に触れたとみなす高さ（m） */
export const GROUND_TOUCH_M = 0.02;
export const TORSO_SIZE = { hw: TORSO.hw, hh: TORSO.hh, headR: HEAD.r };

function shapeMass(s: ShapeSpec): number {
  const area = s.kind === "box" ? 4 * s.hw * s.hh : Math.PI * s.r * s.r;
  return area * s.density;
}
/** 体全体の質量（kg） */
export const BODY_MASS = (Object.values(PART_SHAPES) as ShapeSpec[][])
  .flatMap((shapes) => shapes)
  .reduce((sum, s) => sum + shapeMass(s), 0);

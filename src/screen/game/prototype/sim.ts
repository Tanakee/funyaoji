// 試作（あとで捨てる）：操作の方式を比べるための物理演算。DOM に依存しない
import RAPIER from "@dimforge/rapier2d-compat";

export const JOINTS = ["rightHip", "leftHip", "rightKnee", "leftKnee"] as const;
export type JointName = (typeof JOINTS)[number];

/** angle: 目標角度のモーター / velocity: 目標速度のモーター / string: 物理の糸 / both: 目標角度と糸の併用 */
export type Mode = "angle" | "velocity" | "string" | "both";

export interface Params {
  mode: Mode;
  /** 目標角度のモーターの強さ */
  stiffness: number;
  /** モーターの減衰 */
  damping: number;
  /** 目標速度のモーターの最大の速さ（rad/s） */
  maxSpeed: number;
  /** 糸の強さ（体重の何倍の力を、0.2m の伸びで出すか） */
  stringK: number;
  /** 糸を最大まで引いたときに短くなる長さ（m） */
  stringPull: number;
  /** 糸だけのとき、胴を吊る糸が支える体重の割合（0〜1） */
  support: number;
  /** 吊る点の前後のずれ（m）。0 で真上から引く。大きいと、糸の力が前後に押す力になる */
  stringOffset: number;
  /** 胴を起こす補助の強さ。0 で補助なし */
  assist: number;
  footFriction: number;
  /** 足の大きさの倍率 */
  footScale: number;
  /** 転倒の判定。torso: 胴か頭が地面に触れたら / head: 頭が触れたときだけ */
  fallMode: "torso" | "head";
  /** ひざの半自動。ももを前に振っている間、ひざを自動で曲げる強さ（0 で無し） */
  kneeAuto: number;
  /** 腕を付ける（頭はいつも付く） */
  upperBody: boolean;
}

export const DEFAULT_PARAMS: Params = {
  mode: "angle",
  stiffness: 600,
  damping: 60,
  maxSpeed: 3,
  stringK: 6,
  stringPull: 0.6,
  support: 0.5,
  stringOffset: 0,
  assist: 0,
  footFriction: 1.5,
  footScale: 1,
  fallMode: "torso",
  kneeAuto: 0,
  upperBody: false,
};

// 関節の角度の範囲（rad）。入力 0 が lo、1 が hi
const RANGE: Record<JointName, { lo: number; hi: number }> = {
  rightHip: { lo: -0.6, hi: 1.4 },
  leftHip: { lo: -0.6, hi: 1.4 },
  rightKnee: { lo: 0, hi: -1.6 },
  leftKnee: { lo: 0, hi: -1.6 },
};

/** 操作しないときの入力の値。方式ごとに違う */
export function neutralInput(mode: Mode): Record<JointName, number> {
  if (mode === "velocity") return { rightHip: 0.5, leftHip: 0.5, rightKnee: 0.5, leftKnee: 0.5 };
  if (mode === "string") return { rightHip: 0, leftHip: 0, rightKnee: 0, leftKnee: 0 };
  return { rightHip: 0.3, leftHip: 0.3, rightKnee: 0, leftKnee: 0 };
}

const TORSO = { hw: 0.16, hh: 0.32 };
const THIGH = { hw: 0.07, hh: 0.22 };
const SHIN = { hw: 0.06, hh: 0.22 };
const FOOT = { hw: 0.13, hh: 0.04 };
const HIP_Y = THIGH.hh * 2 + SHIN.hh * 2 + FOOT.hh * 2;
const HANG_Y = 2.5;
export const GOAL_M = 10;

const GROUP_GROUND = (0x0001 << 16) | 0xffff;
const GROUP_BODY = (0x0002 << 16) | 0x0001;

export type Shape =
  | { kind: "box"; ox: number; oy: number; hw: number; hh: number }
  | { kind: "ball"; ox: number; oy: number; r: number };

export interface Part {
  name: string;
  body: RAPIER.RigidBody;
  shapes: Shape[];
  side: "center" | "right" | "left";
}

export interface StringView {
  joint: JointName;
  from: { x: number; y: number };
  to: { x: number; y: number };
  taut: boolean;
}

export class Sim {
  world: RAPIER.World;
  parts: Part[] = [];
  torso: RAPIER.RigidBody;
  joints = {} as Record<JointName, RAPIER.RevoluteImpulseJoint>;
  children = {} as Record<JointName, { parent: RAPIER.RigidBody; child: RAPIER.RigidBody }>;
  strings: StringView[] = [];
  mass = 0;
  time = 0;
  ended: "goal" | "fell" | undefined;
  private prevInput: Record<JointName, number> | undefined;
  params: Params;

  static async init(): Promise<void> {
    await RAPIER.init();
  }

  constructor(params: Params) {
    this.params = params;
    const world = new RAPIER.World({ x: 0, y: -9.81 });
    world.timestep = 1 / 60;
    this.world = world;

    const ground = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0, -0.5));
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(500, 0.5).setFriction(1).setCollisionGroups(GROUP_GROUND),
      ground,
    );

    const box = (
      body: RAPIER.RigidBody,
      s: { hw: number; hh: number },
      density: number,
      friction: number,
      ox = 0,
      oy = 0,
    ): Shape => {
      world.createCollider(
        RAPIER.ColliderDesc.cuboid(s.hw, s.hh)
          .setTranslation(ox, oy)
          .setDensity(density)
          .setFriction(friction)
          .setCollisionGroups(GROUP_BODY),
        body,
      );
      return { kind: "box", ox, oy, hw: s.hw, hh: s.hh };
    };
    const dynamic = (x: number, y: number) =>
      world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(x, y));

    // 密度は、QWOP の再現実装の質量比（胴 18：もも 10：すね 7：足 11）に近づけた値
    const torso = dynamic(0, HIP_Y + TORSO.hh);
    this.torso = torso;
    const torsoShapes: Shape[] = [box(torso, TORSO, 50, 0.2)];
    {
      const r = 0.12;
      world.createCollider(
        RAPIER.ColliderDesc.ball(r)
          .setTranslation(0, TORSO.hh + r)
          .setDensity(30)
          .setFriction(0.2)
          .setCollisionGroups(GROUP_BODY),
        torso,
      );
      torsoShapes.push({ kind: "ball", ox: 0, oy: TORSO.hh + r, r });
    }
    this.parts.push({ name: "torso", body: torso, shapes: torsoShapes, side: "center" });

    for (const side of ["left", "right"] as const) {
      const thigh = dynamic(0, HIP_Y - THIGH.hh);
      const shin = dynamic(0, HIP_Y - THIGH.hh * 2 - SHIN.hh);
      this.parts.push({ name: "thigh", body: thigh, shapes: [box(thigh, THIGH, 90, 0.2)], side });
      this.parts.push({
        name: "shin",
        body: shin,
        shapes: [
          box(shin, SHIN, 75, 0.2),
          // 足はすねに固定する（足首は動かない）。足だけ摩擦と密度を大きくする
          box(
            shin,
            { hw: FOOT.hw * params.footScale, hh: FOOT.hh },
            300 / params.footScale,
            params.footFriction,
            0.03 * params.footScale,
            -SHIN.hh - FOOT.hh,
          ),
        ],
        side,
      });
      const hip = world.createImpulseJoint(
        RAPIER.JointData.revolute({ x: 0, y: -TORSO.hh }, { x: 0, y: THIGH.hh }),
        torso,
        thigh,
        true,
      ) as RAPIER.RevoluteImpulseJoint;
      const knee = world.createImpulseJoint(
        RAPIER.JointData.revolute({ x: 0, y: -THIGH.hh }, { x: 0, y: SHIN.hh }),
        thigh,
        shin,
        true,
      ) as RAPIER.RevoluteImpulseJoint;
      const hipName: JointName = `${side}Hip`;
      const kneeName: JointName = `${side}Knee`;
      hip.setLimits(RANGE[hipName].lo, RANGE[hipName].hi);
      knee.setLimits(RANGE[kneeName].hi, RANGE[kneeName].lo);
      this.joints[hipName] = hip;
      this.joints[kneeName] = knee;
      this.children[hipName] = { parent: torso, child: thigh };
      this.children[kneeName] = { parent: thigh, child: shin };

      if (params.upperBody) {
        const ARM = { hw: 0.045, hh: 0.26 };
        const arm = dynamic(0, HIP_Y + TORSO.hh * 2 - 0.08 - ARM.hh);
        this.parts.push({ name: "arm", body: arm, shapes: [box(arm, ARM, 40, 0.2)], side });
        const shoulder = world.createImpulseJoint(
          RAPIER.JointData.revolute({ x: 0, y: TORSO.hh - 0.08 }, { x: 0, y: ARM.hh }),
          torso,
          arm,
          true,
        ) as RAPIER.RevoluteImpulseJoint;
        shoulder.setLimits(-2.5, 2.5);
        // 腕はモーターなし。少しだけ減衰を付けて、ぶらぶらさせる
        shoulder.configureMotorVelocity(0, 0.5);
      }
    }
    this.mass = this.parts.reduce((m, p) => m + p.body.mass(), 0);
    if (this.mass === 0) {
      // mass() は最初の step のあとで入ることがある。概算を入れておく
      this.mass = 45;
    }
  }

  jointAngle(name: JointName): number {
    const { parent, child } = this.children[name];
    let a = child.rotation() - parent.rotation();
    while (a > Math.PI) a -= Math.PI * 2;
    while (a < -Math.PI) a += Math.PI * 2;
    return a;
  }

  targetAngle(name: JointName, u: number): number {
    const { lo, hi } = RANGE[name];
    return lo + (hi - lo) * u;
  }

  get distance(): number {
    return this.torso.translation().x;
  }

  step(input: Record<JointName, number>): void {
    if (this.ended) return;
    const p = this.params;
    for (const part of this.parts) {
      part.body.resetForces(true);
      part.body.resetTorques(true);
    }

    const prev = this.prevInput ?? input;
    this.prevInput = { ...input };
    for (const name of JOINTS) {
      const joint = this.joints[name];
      let u = Math.min(1, Math.max(0, input[name]));
      if (p.kneeAuto > 0 && name.endsWith("Knee")) {
        // ももの入力が上がっている間（前に振っている間）、ひざを自動で曲げる
        const hip: JointName = name === "rightKnee" ? "rightHip" : "leftHip";
        const rate = (input[hip] - prev[hip]) / this.world.timestep;
        u = Math.max(u, Math.min(1, Math.max(0, rate * 0.6)) * p.kneeAuto);
      }
      if (p.mode === "angle" || p.mode === "both") {
        joint.configureMotorPosition(this.targetAngle(name, u), p.stiffness, p.damping);
      } else if (p.mode === "velocity") {
        const dir = Math.sign(RANGE[name].hi - RANGE[name].lo);
        joint.configureMotorVelocity((u - 0.5) * 2 * p.maxSpeed * dir, p.stiffness * 5);
      } else {
        // 糸だけ：モーターは使わない。少しだけ減衰を付ける
        joint.configureMotorVelocity(0, 1);
      }
    }

    this.strings = [];
    if (p.mode === "string" || p.mode === "both") {
      const tx = this.torso.translation().x;
      for (const name of JOINTS) {
        const isHip = name.endsWith("Hip");
        const body = this.children[name].child;
        // 股関節の糸はひざ（ももの下の端）、ひざの糸は足首（すねの下の端）を引く
        const hh = isHip ? THIGH.hh : SHIN.hh;
        const rot = body.rotation();
        const c = body.translation();
        const at = { x: c.x + Math.sin(rot) * hh, y: c.y - Math.cos(rot) * hh };
        // 吊る点は体と一緒に動く。股関節の糸は少し前、ひざの糸は少し後ろ
        const hang = { x: tx + (isHip ? p.stringOffset : -p.stringOffset * 0.7), y: HANG_Y };
        const slack = isHip ? HANG_Y - (HIP_Y - THIGH.hh * 2) + 0.06 : HANG_Y - FOOT.hh * 2 + 0.06;
        const u = Math.min(1, Math.max(0, input[name]));
        // 併用のときは、モーターの中立の姿勢で糸がちょうど張る長さにする
        const base = p.mode === "both" ? neutralInput("both")[name] : 0;
        const len = slack - Math.max(0, u - base) * p.stringPull;
        const dx = hang.x - at.x;
        const dy = hang.y - at.y;
        const dist = Math.hypot(dx, dy);
        const taut = dist > len;
        if (taut) {
          const nx = dx / dist;
          const ny = dy / dist;
          const v = body.velocityAtPoint(at);
          const along = v.x * nx + v.y * ny;
          const weight = this.mass * 9.81;
          const k = p.mode === "both" ? p.stringK * 0.3 : p.stringK;
          const f = Math.max(0, ((k * weight) / 0.2) * (dist - len) - weight * 0.5 * along);
          const capped = Math.min(f, weight * 3);
          body.addForceAtPoint({ x: nx * capped, y: ny * capped }, at, true);
          // 糸の反対側は、胴に付いた枠が持っている扱いにする。同じ大きさで逆向きの力を胴にかける。
          // こうしないと、体の外から押す力になり、足が浮いていても勝手に進む
          this.torso.addForce({ x: -nx * capped, y: -ny * capped }, true);
        }
        this.strings.push({ joint: name, from: hang, to: at, taut });
      }
    }

    if (p.mode === "string") {
      // 糸だけのときは、操り人形のように、胴の上の端を糸で吊って体重を支える
      const weight = this.mass * 9.81;
      const rot = this.torso.rotation();
      const c = this.torso.translation();
      const top = { x: c.x - Math.sin(rot) * TORSO.hh, y: c.y + Math.cos(rot) * TORSO.hh };
      const vy = this.torso.velocityAtPoint(top).y;
      const fy = Math.max(0, weight * (p.support + 8 * (HIP_Y + TORSO.hh * 2 - top.y)) - weight * 0.6 * vy);
      this.torso.addForceAtPoint({ x: 0, y: Math.min(fy, weight * 3) }, top, true);
      this.strings.push({
        joint: "rightHip",
        from: { x: top.x, y: HANG_Y },
        to: top,
        taut: true,
      });
    }

    if (p.assist > 0) {
      const weight = this.mass * 9.81;
      const torque =
        -p.assist * weight * 0.5 * this.torso.rotation() -
        p.assist * weight * 0.08 * this.torso.angvel();
      this.torso.addTorque(torque, true);
    }

    this.world.step();
    this.time += this.world.timestep;
    if (this.mass === 45) {
      const m = this.parts.reduce((s, part) => s + part.body.mass(), 0);
      if (m > 0) this.mass = m;
    }

    if (this.distance >= GOAL_M) this.ended = "goal";
    else if (this.touchesGround()) this.ended = "fell";
  }

  /** 胴か頭が地面に触れたか */
  private touchesGround(): boolean {
    const t = this.torso.translation();
    const rot = this.torso.rotation();
    const cos = Math.cos(rot);
    const sin = Math.sin(rot);
    for (const sx of this.params.fallMode === "head" ? [] : [-1, 1]) {
      for (const sy of [-1, 1]) {
        const y = t.y + sx * TORSO.hw * sin + sy * TORSO.hh * cos;
        if (y < 0.02) return true;
      }
    }
    {
      const hy = t.y + (TORSO.hh + 0.12) * cos;
      if (hy - 0.12 < 0.02) return true;
    }
    return false;
  }
}

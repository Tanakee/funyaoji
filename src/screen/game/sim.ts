// 物理演算とゲームのルール（距離・ゴール・転倒・座り込み）。DOM にも PixiJS にも依存しない
// 入力は関節ごとの 0〜1。1 ステップずつ進め、いまの姿勢は state() で読む
import RAPIER from "@dimforge/rapier2d-compat";
import { JOINTS, type Joint } from "../../shared/messages.ts";
import {
  BODY_MASS,
  GROUND_TOUCH_M,
  INITIAL_POSES,
  JOINT_SPECS,
  MOTOR,
  PART_NAMES,
  PART_SHAPES,
  STEP_S,
  TORSO_ASSIST,
  TORSO_SIZE,
  type PartName,
  type Pose,
} from "./body.ts";
import type { GameResult, JointInputs } from "./types.ts";

export const GOAL_M = 10;
/**
 * 胴の中心がこの高さ（m）より低い状態が SIT_MS 続いたら、座り込んだとみなし、転倒と同じに終える（docs/game.md）。
 * 立っていると約1.3m、歩いていても1.2m より下がらない。ひざを深く曲げて座り込むと0.9m 以下になり、そこからは立ち上がれない
 */
export const SIT_HEIGHT_M = 1.0;
export const SIT_MS = 3_000;

const GRAVITY = 9.81;
// 体は地面とだけ当たる。左右の脚は互いにすり抜ける
const GROUP_GROUND = (0x0001 << 16) | 0xffff;
const GROUP_BODY = (0x0002 << 16) | 0x0001;

export type RunStatus = "ready" | "running" | "ended";

/** 描画が読む、いまの姿勢と進み具合。物理エンジンの型を含まない */
export interface SimState {
  poses: Record<PartName, Pose>;
  distanceM: number;
  elapsedMs: number;
  status: RunStatus;
  /** status が ended のときだけある */
  result: GameResult | undefined;
}

/** 部位の位置・傾きと、速度・回る速さ（rad/s） */
export interface PartMotion extends Pose {
  vx: number;
  vy: number;
  w: number;
}

/** 関節の角度と回る速さ。子の部位の傾き − 親の部位の傾き（rad）。範囲は body.ts の range の向きのまま */
export interface JointMotion {
  angle: number;
  speed: number;
}

/**
 * 強化学習の観測に使う、物理の状態（docs/ml.md の「観測に要る値を読む」）。読むだけで、物理は変えない。
 * 物理エンジンの型を含まない
 */
export interface SimReadout {
  parts: Record<PartName, PartMotion>;
  joints: Record<Joint, JointMotion>;
  /** 足の裏の低い方の角が、地面から FOOT_CONTACT_M 以内にあるか */
  footContact: { right: boolean; left: boolean };
  /** 胴の中心が SIT_HEIGHT_M より低くなってからの時間（ミリ秒）。低くなければ 0 */
  sittingMs: number;
  distanceM: number;
  elapsedMs: number;
  status: RunStatus;
}

export interface SimOptions {
  /** 物理の1ステップ（秒）。既定は STEP_S。ゲームは既定のまま使う。強化学習で刻みの影響を測るときだけ変える */
  stepS?: number;
}

/** 足が地面に着いているとみなす高さ（m） */
export const FOOT_CONTACT_M = 0.03;

let initialized: Promise<void> | undefined;
/** Rapier の WASM を読み込む。Sim を作る前に1回待つ（何度呼んでもよい） */
export function initPhysics(): Promise<void> {
  initialized ??= RAPIER.init();
  return initialized;
}

const clamp01 = (u: number) => (Number.isFinite(u) ? Math.min(1, Math.max(0, u)) : 0);

/** -π〜π に折り返す */
function wrapAngle(a: number): number {
  return a - 2 * Math.PI * Math.round(a / (2 * Math.PI));
}

/** すねの姿勢から、足の裏の低い方の角の高さを出す */
function footBottom(shin: Pose): number {
  const foot = PART_SHAPES.rightShin.find((s) => s.tag === "foot");
  if (!foot || foot.kind !== "box") return Infinity;
  const cos = Math.cos(shin.rot);
  const sin = Math.sin(shin.rot);
  let low = Infinity;
  for (const sx of [-1, 1]) {
    const x = foot.ox + sx * foot.hw;
    const y = foot.oy - foot.hh;
    low = Math.min(low, shin.y + x * sin + y * cos);
  }
  return low;
}

/** 胴の四隅か頭が地面に触れているか */
function touchesGround(torso: Pose): boolean {
  const { hw, hh, headR } = TORSO_SIZE;
  const cos = Math.cos(torso.rot);
  const sin = Math.sin(torso.rot);
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      if (torso.y + sx * hw * sin + sy * hh * cos < GROUND_TOUCH_M) return true;
    }
  }
  const headBottom = torso.y + (hh + headR) * cos - headR;
  return headBottom < GROUND_TOUCH_M;
}

export class Sim {
  private readonly world: RAPIER.World;
  private readonly bodies = {} as Record<PartName, RAPIER.RigidBody>;
  private readonly motors = {} as Record<Joint, RAPIER.RevoluteImpulseJoint>;
  private steps = 0;
  private pending = 0;
  private status: RunStatus = "ready";
  private result: GameResult | undefined;

  /** 胴が SIT_HEIGHT_M より低くなった時刻。低くなければ undefined */
  private sittingSinceMs: number | undefined;
  private readonly stepS: number;

  constructor(options: SimOptions = {}) {
    this.stepS = options.stepS ?? STEP_S;
    const world = new RAPIER.World({ x: 0, y: -GRAVITY });
    world.timestep = this.stepS;
    this.world = world;

    const ground = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0, -0.5));
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(500, 0.5).setFriction(1).setCollisionGroups(GROUP_GROUND),
      ground,
    );

    for (const name of PART_NAMES) {
      const pose = INITIAL_POSES[name];
      const body = world.createRigidBody(
        RAPIER.RigidBodyDesc.dynamic().setTranslation(pose.x, pose.y),
      );
      for (const s of PART_SHAPES[name]) {
        const desc =
          s.kind === "box" ? RAPIER.ColliderDesc.cuboid(s.hw, s.hh) : RAPIER.ColliderDesc.ball(s.r);
        world.createCollider(
          desc
            .setTranslation(s.ox, s.oy)
            .setDensity(s.density)
            .setFriction(s.friction)
            .setCollisionGroups(GROUP_BODY),
          body,
        );
      }
      this.bodies[name] = body;
    }

    for (const joint of JOINTS) {
      const spec = JOINT_SPECS[joint];
      const j = world.createImpulseJoint(
        RAPIER.JointData.revolute(spec.parentAnchor, spec.childAnchor),
        this.bodies[spec.parent],
        this.bodies[spec.child],
        true,
      ) as RAPIER.RevoluteImpulseJoint;
      j.setLimits(Math.min(...spec.range), Math.max(...spec.range));
      this.motors[joint] = j;
    }
  }

  /** 物理演算とタイムを進め始める。ready のときだけ効く */
  start(): void {
    if (this.status === "ready") this.status = "running";
  }

  /**
   * 実時間 dtSec 秒ぶん進める。物理は固定の 1 ステップ（STEP_S）ずつ進め、
   * 余りは次に回すので、フレームレートが違っても物理は変わらない
   */
  advance(inputs: JointInputs, dtSec: number): void {
    if (this.status !== "running") return;
    this.pending += dtSec;
    while (this.pending >= this.stepS && this.status === "running") {
      this.step(inputs);
      this.pending -= this.stepS;
    }
  }

  private step(inputs: JointInputs): void {
    for (const body of Object.values(this.bodies)) {
      body.resetForces(true);
      body.resetTorques(true);
    }
    for (const joint of JOINTS) {
      const [lo, hi] = JOINT_SPECS[joint].range;
      const target = lo + (hi - lo) * clamp01(inputs[joint]);
      const motor = this.motors[joint];
      motor.configureMotorPosition(target, MOTOR.stiffness, MOTOR.damping);
      motor.setMotorMaxForce(MOTOR.maxForceBodyWeights * BODY_MASS * GRAVITY);
    }
    this.assistTorso();

    this.world.step();
    this.steps++;

    const { poses, distanceM, elapsedMs } = this.readPose();
    if (poses.torso.y >= SIT_HEIGHT_M) this.sittingSinceMs = undefined;
    else this.sittingSinceMs ??= elapsedMs;
    const sat = this.sittingSinceMs !== undefined && elapsedMs - this.sittingSinceMs >= SIT_MS;
    if (distanceM >= GOAL_M) {
      this.end({ outcome: "goal", distanceM, timeMs: Math.round(elapsedMs) });
    } else if (touchesGround(poses.torso) || sat) {
      this.end({ outcome: "fell", distanceM });
    }
  }

  /**
   * 胴を起こす補助。強い補助をそのままかけると 1 ステップの間に行き過ぎて振動するので、
   * 1 ステップ先の角度を見込んで力を弱める形（安定な PD 制御）にする
   */
  private assistTorso(): void {
    const torso = this.bodies.torso;
    const weight = BODY_MASS * GRAVITY;
    const kp = TORSO_ASSIST * weight * 0.5;
    const kd = TORSO_ASSIST * weight * 0.08;
    const inertia = Math.max(1e-6, torso.principalInertia());
    const w = torso.angvel();
    const torque =
      -(kp * (torso.rotation() + this.stepS * w) + kd * w) /
      (1 + (this.stepS * (kd + kp * this.stepS)) / inertia);
    torso.addTorque(torque, true);
  }

  private end(result: GameResult): void {
    this.status = "ended";
    this.result = result;
  }

  private readPose() {
    const poses = {} as Record<PartName, Pose>;
    for (const name of PART_NAMES) {
      const t = this.bodies[name].translation();
      poses[name] = { x: t.x, y: t.y, rot: this.bodies[name].rotation() };
    }
    return {
      poses,
      distanceM: poses.torso.x,
      elapsedMs: this.steps * this.stepS * 1000,
    };
  }

  state(): SimState {
    return { ...this.readPose(), status: this.status, result: this.result };
  }

  /** 強化学習の観測に使う値を読む。物理は変えない */
  readout(): SimReadout {
    const { distanceM, elapsedMs } = this.readPose();
    const parts = {} as Record<PartName, PartMotion>;
    for (const name of PART_NAMES) {
      const b = this.bodies[name];
      const t = b.translation();
      const v = b.linvel();
      parts[name] = { x: t.x, y: t.y, rot: b.rotation(), vx: v.x, vy: v.y, w: b.angvel() };
    }
    const joints = {} as Record<Joint, JointMotion>;
    for (const joint of JOINTS) {
      const { parent, child } = JOINT_SPECS[joint];
      joints[joint] = {
        angle: wrapAngle(parts[child].rot - parts[parent].rot),
        speed: parts[child].w - parts[parent].w,
      };
    }
    return {
      parts,
      joints,
      footContact: {
        right: footBottom(parts.rightShin) < FOOT_CONTACT_M,
        left: footBottom(parts.leftShin) < FOOT_CONTACT_M,
      },
      sittingMs: this.sittingSinceMs === undefined ? 0 : elapsedMs - this.sittingSinceMs,
      distanceM,
      elapsedMs,
      status: this.status,
    };
  }

  /** WASM 側のメモリを返す。このあと使わない */
  free(): void {
    this.world.free();
  }
}

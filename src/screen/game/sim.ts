// 物理演算とゲームのルール（距離・ゴール・転倒・タイムアウト）。DOM にも PixiJS にも依存しない
// 入力は関節ごとの 0〜1。1 コマずつ進め、いまの姿勢は state() で読む
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
  TORSO_ASSIST,
  TORSO_SIZE,
  type PartName,
  type Pose,
} from "./body.ts";
import type { GameResult, JointInputs } from "./types.ts";

export const GOAL_M = 10;
/** 開始からこの時間でタイムアウト（docs/game.md）。仮の値で、遊んで直す */
export const TIMEOUT_MS = 120_000;
/** 物理の 1 コマ。細かく刻むほど、強いモーターでも振動しにくい */
export const STEP_S = 1 / 240;

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

let initialized: Promise<void> | undefined;
/** Rapier の WASM を読み込む。Sim を作る前に1回待つ（何度呼んでもよい） */
export function initPhysics(): Promise<void> {
  initialized ??= RAPIER.init();
  return initialized;
}

const clamp01 = (u: number) => (Number.isFinite(u) ? Math.min(1, Math.max(0, u)) : 0);

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

  private readonly timeoutMs: number;

  constructor(timeoutMs: number = TIMEOUT_MS) {
    this.timeoutMs = timeoutMs;
    const world = new RAPIER.World({ x: 0, y: -GRAVITY });
    world.timestep = STEP_S;
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
   * 実時間 dtSec 秒ぶん進める。物理は固定の 1 コマ（STEP_S）ずつ進め、
   * 余りは次に回すので、描画のコマ数が違っても物理は変わらない
   */
  advance(inputs: JointInputs, dtSec: number): void {
    if (this.status !== "running") return;
    this.pending += dtSec;
    while (this.pending >= STEP_S && this.status === "running") {
      this.step(inputs);
      this.pending -= STEP_S;
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
    if (distanceM >= GOAL_M) {
      this.end({ outcome: "goal", distanceM, timeMs: Math.round(elapsedMs) });
    } else if (touchesGround(poses.torso)) {
      this.end({ outcome: "fell", distanceM });
    } else if (elapsedMs >= this.timeoutMs) {
      this.end({ outcome: "timeout", distanceM });
    }
  }

  /**
   * 胴を起こす補助。強い補助をそのままかけると 1 コマの間に行き過ぎて振動するので、
   * 1 コマ先の角度を見込んで力を弱める形（安定な PD 制御）にする
   */
  private assistTorso(): void {
    const torso = this.bodies.torso;
    const weight = BODY_MASS * GRAVITY;
    const kp = TORSO_ASSIST * weight * 0.5;
    const kd = TORSO_ASSIST * weight * 0.08;
    const inertia = Math.max(1e-6, torso.principalInertia());
    const w = torso.angvel();
    const torque =
      -(kp * (torso.rotation() + STEP_S * w) + kd * w) /
      (1 + (STEP_S * (kd + kp * STEP_S)) / inertia);
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
      elapsedMs: this.steps * STEP_S * 1000,
    };
  }

  state(): SimState {
    return { ...this.readPose(), status: this.status, result: this.result };
  }

  /** WASM 側のメモリを返す。このあと使わない */
  free(): void {
    this.world.free();
  }
}

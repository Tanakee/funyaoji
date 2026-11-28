import RAPIER from "@dimforge/rapier2d-compat";
import { beforeAll, describe, expect, test, vi } from "vite-plus/test";
import { JOINTS, type Joint } from "../../shared/messages.ts";
import { DEMO_GAIT, type Gait, gaitRecord } from "./ai/gait.ts";
import { replay } from "./ai/record.ts";
import { BODY_MASS, HARD_MOTOR, MOTOR, NEUTRAL_INPUTS, STEP_S } from "./body.ts";
import { demoGait as gait } from "./demo.ts";
import { moveInputs } from "./keyboard.ts";
import { SIT_MS, Sim, initPhysics } from "./sim.ts";
import type { JointInputs } from "./types.ts";

const NEUTRAL: JointInputs = { ...NEUTRAL_INPUTS };

const FRAME = 1 / 60;
/** 終わるか limitSec 秒たつまで、1/60 秒ずつ進める */
function run(sim: Sim, inputs: (t: number) => JointInputs, limitSec: number) {
  sim.start();
  for (let t = 0; t < limitSec && sim.state().status === "running"; t += FRAME) {
    sim.advance(inputs(t), FRAME);
  }
  return sim.state();
}

beforeAll(initPhysics);

describe("Sim", () => {
  test("start の前は物理もタイムも進まない", () => {
    const sim = new Sim();
    const before = sim.state();
    sim.advance(NEUTRAL, 1);
    expect(sim.state()).toEqual(before);
    expect(before).toMatchObject({ status: "ready", distanceM: 0, elapsedMs: 0 });
    sim.free();
  });

  test("操作しないで 3 秒たっても、転倒で終わらない", () => {
    const sim = new Sim();
    const s = run(sim, () => NEUTRAL, 3);
    expect(s.status).toBe("running");
    expect(s.elapsedMs).toBeGreaterThan(2900);
    sim.free();
  });

  test("お手本の歩き方で、10m に着いてゴールになる", () => {
    const sim = new Sim();
    const s = run(sim, gait, 60);
    expect(s.result).toMatchObject({ outcome: "goal" });
    if (s.result?.outcome !== "goal") throw new Error("ゴールしていない");
    expect(s.result.distanceM).toBeGreaterThanOrEqual(10);
    expect(s.result.timeMs).toBeGreaterThan(5_000);
    expect(s.result.timeMs).toBeLessThan(40_000);
    sim.free();
  });

  test("ゴールで終わったあとは、入力を続けても姿勢が動かない", () => {
    const sim = new Sim();
    const ended = run(sim, gait, 60);
    sim.advance(gait(1), 2);
    expect(sim.state()).toEqual(ended);
    sim.free();
  });

  test("関節をでたらめに動かし続けると、転倒で終わる", () => {
    // 0.5 秒ごとに、4つの関節を 0 か 1 に切り替える。シードを変えても、20 秒以内に全部転ぶ
    for (const seed of [1, 2, 3]) {
      let x = seed;
      const rnd = () => ((x = (x * 1664525 + 1013904223) >>> 0) / 4294967296 < 0.5 ? 0 : 1);
      let held = NEUTRAL;
      let nextChange = 0;
      const sim = new Sim();
      const s = run(
        sim,
        (t) => {
          if (t >= nextChange) {
            nextChange += 0.5;
            held = { rightHip: rnd(), leftHip: rnd(), rightKnee: rnd(), leftKnee: rnd() };
          }
          return held;
        },
        30,
      );
      expect(s.result?.outcome, `シード ${seed}`).toBe("fell");
      expect(s.elapsedMs).toBeLessThan(20_000);
      sim.free();
    }
  });

  test("立ったまま止まっていても、終わらない", () => {
    const sim = new Sim();
    const s = run(sim, () => NEUTRAL, 20);
    expect(s.result).toBeUndefined();
    sim.free();
  });

  test("ひざを曲げて座り込むと、SIT_MS のあとに転倒と同じに終わる", () => {
    const sim = new Sim();
    const s = run(sim, () => ({ ...NEUTRAL, rightKnee: 1, leftKnee: 1 }), 20);
    expect(s.result?.outcome).toBe("fell");
    // 座り込むまでに1秒ほどかかり、そこから SIT_MS 待つ
    expect(s.elapsedMs).toBeGreaterThanOrEqual(SIT_MS);
    expect(s.elapsedMs).toBeLessThan(SIT_MS + 3_000);
    sim.free();
  });

  test("作り直して3回走らせても、1回目と同じ結果になる", () => {
    const results = [1, 2, 3].map(() => {
      const sim = new Sim();
      const s = run(sim, gait, 60);
      sim.free();
      return s.result;
    });
    expect(results[0]?.outcome).toBe("goal");
    expect(results).toEqual([results[0], results[0], results[0]]);
  });

  test("フレームレートが違っても、同じ時間なら同じ結果になる", () => {
    const at = (frameSec: number) => {
      const sim = new Sim();
      sim.start();
      for (let t = 0; t < 4; t += frameSec) sim.advance(gait(t), frameSec);
      const s = sim.state();
      sim.free();
      return s.distanceM;
    };
    expect(at(1 / 30)).toBeCloseTo(at(1 / 120), 1);
  });
});

describe("練習の Sim", () => {
  test("関節をでたらめに10秒動かしても、胴と進行が止まったまま足は地面に着かない", () => {
    const sim = new Sim({ practice: true });
    const torso = sim.state().poses.torso;
    let seed = 1;
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) < 2 ** 31 ? 0 : 1);
    for (let i = 0; i < 20; i++) {
      const inputs = { rightHip: rnd(), leftHip: rnd(), rightKnee: rnd(), leftKnee: rnd() };
      for (let step = 0; step < 0.5 / STEP_S; step++) {
        sim.advance(inputs, STEP_S);
        expect(sim.readout().footContact).toEqual({ right: false, left: false });
      }
    }
    const state = sim.state();
    sim.free();
    expect(state.poses.torso.x).toBeCloseTo(torso.x, 8);
    expect(state.poses.torso.y).toBeCloseTo(torso.y, 8);
    expect(state.poses.torso.rot).toBeCloseTo(torso.rot, 8);
    expect(state).toMatchObject({
      status: "ready",
      elapsedMs: 0,
      distanceM: 0,
      result: undefined,
    });
  });

  test("右ももの入力で右ももが動き、左脚の関節は立った姿勢を保つ", () => {
    const sim = new Sim({ practice: true });
    const before = sim.readout().joints;
    sim.advance({ ...NEUTRAL, rightHip: 1 }, 1);
    const after = sim.readout().joints;
    sim.free();
    expect(after.rightHip.angle - before.rightHip.angle).toBeGreaterThan(0.1);
    // 0.001 rad（約0.06度）は、画面では見分けられない
    expect(Math.abs(after.leftHip.angle - before.leftHip.angle)).toBeLessThan(0.001);
    expect(Math.abs(after.leftKnee.angle - before.leftKnee.angle)).toBeLessThan(0.001);
  });

  test("start を呼んでも、練習ではタイムが進まない", () => {
    const sim = new Sim({ practice: true });
    sim.start();
    sim.advance(NEUTRAL, 1);
    const state = sim.state();
    sim.free();
    expect(state).toMatchObject({ status: "ready", elapsedMs: 0 });
  });

  test.each([
    { joint: "rightHip", key: "KeyQ", hard: false },
    { joint: "rightKnee", key: "KeyO", hard: false },
    { joint: "rightHip", key: "KeyQ", hard: true },
    { joint: "rightKnee", key: "KeyO", hard: true },
  ] as const)(
    "$joint の反応はプレイ中と1ステップ以内の差に収まる（hard: $hard）",
    ({ joint, key, hard }) => {
      // 動き始めを見る。立った姿勢の入力のまま揺れる幅（練習・プレイ中とも 0.0001 rad 未満）より大きくする
      const threshold = 0.0002;
      const stepsToMove = (practice: boolean): number => {
        const sim = new Sim({ practice, hard });
        try {
          if (!practice) sim.start();
          for (let step = 0; step < 1 / STEP_S; step++) sim.advance(NEUTRAL, STEP_S);
          const initialAngle = sim.readout().joints[joint].angle;
          const inputs = { ...NEUTRAL };
          const held = new Set([key]);
          const driving = new Set<Joint>();
          for (let step = 0; step < 1 / STEP_S; step++) {
            if (step % (FRAME / STEP_S) === 0) moveInputs(inputs, held, FRAME, driving);
            sim.advance(inputs, STEP_S);
            if (Math.abs(sim.readout().joints[joint].angle - initialAngle) > threshold) {
              return step + 1;
            }
          }
          throw new Error(`${joint} が1秒以内に動かなかった（練習: ${practice}）`);
        } finally {
          sim.free();
        }
      };
      const practice = stepsToMove(true);
      const playing = stepsToMove(false);
      expect(
        Math.abs(practice - playing),
        `練習 ${practice} ステップ、プレイ中 ${playing} ステップ`,
      ).toBeLessThanOrEqual(1);
    },
  );

  test("練習を作って動かしてから走らせても、お手本の結果が一致する", () => {
    const demoResult = () => {
      const sim = new Sim();
      const { result } = run(sim, gait, 60);
      sim.free();
      return result;
    };
    const before = demoResult();
    expect(before?.outcome).toBe("goal");
    const practice = new Sim({ practice: true });
    practice.advance({ ...NEUTRAL, rightHip: 1 }, 1);
    practice.free();
    expect(demoResult()).toEqual(before);
  });
});

describe("ハードの Sim", () => {
  /** ハードで、体の状態を見ずにゴールできる歩き方。scripts/hard-mode.ts で見つけた。5つの値を1つずつ ±5% ずらしてもゴールする（--perturb） */
  const HARD_GAIT: Gait = { T: 2.92, h0: 0.58, A: 0.39, K: 0.4, kp: 0.23 };

  test("片脚を前に振ると、胴を起こす補助が無いので、ノーマルより胴が大きく傾く", () => {
    const maxTilt = (hard: boolean) => {
      const sim = new Sim({ hard });
      sim.start();
      let max = 0;
      for (let t = 0; t < 0.6; t += FRAME) {
        sim.advance({ ...NEUTRAL, rightHip: 1 }, FRAME);
        max = Math.max(max, Math.abs(sim.state().poses.torso.rot));
      }
      sim.free();
      return max;
    };
    const normal = maxTilt(false);
    const hard = maxTilt(true);
    expect(hard, `ノーマル ${normal} rad、ハード ${hard} rad`).toBeGreaterThan(normal * 2);
  });

  test.each([
    { hard: false, motor: MOTOR },
    { hard: true, motor: HARD_MOTOR },
  ])(
    "プレイ中、4つの関節すべてに、モーターの値を毎ステップ設定する（hard: $hard）",
    ({ hard, motor }) => {
      // Rapier の関節からは力の上限を読めないので、設定する呼び出しを横から見る。元の処理はそのまま呼ぶ
      const maxForce = vi.spyOn(RAPIER.UnitImpulseJoint.prototype, "setMotorMaxForce");
      const position = vi.spyOn(RAPIER.UnitImpulseJoint.prototype, "configureMotorPosition");
      const steps = 3;
      try {
        const sim = new Sim({ hard });
        sim.start();
        maxForce.mockClear();
        position.mockClear();
        sim.advance(NEUTRAL, steps * STEP_S + STEP_S / 2);
        expect(sim.state().elapsedMs).toBeCloseTo(steps * STEP_S * 1000, 6);
        sim.free();

        const handles = (contexts: unknown[]) =>
          new Set(contexts.map((j) => (j as RAPIER.UnitImpulseJoint).handle));
        expect(handles(maxForce.mock.contexts).size).toBe(JOINTS.length);
        expect(handles(position.mock.contexts).size).toBe(JOINTS.length);
        expect(maxForce.mock.calls).toEqual(
          Array.from({ length: JOINTS.length * steps }, () => [
            // 9.81 は sim.ts の重力。sim.ts と同じ順に掛ける
            motor.maxForceBodyWeights * BODY_MASS * 9.81,
          ]),
        );
        for (const [, stiffness, damping] of position.mock.calls) {
          expect([stiffness, damping]).toEqual([motor.stiffness, motor.damping]);
        }
        expect(position.mock.calls).toHaveLength(JOINTS.length * steps);
      } finally {
        maxForce.mockRestore();
        position.mockRestore();
      }
    },
  );

  test("ハードのモーターの力の上限は、ノーマルより小さい", () => {
    expect(HARD_MOTOR.maxForceBodyWeights).toBeLessThan(MOTOR.maxForceBodyWeights);
  });

  test("お手本の歩き方は、ノーマルではゴールするが、ハードでは転ぶ", () => {
    const end = (hard: boolean) => replay(gaitRecord(DEMO_GAIT, 60), { hard });
    expect(end(false).result?.outcome).toBe("goal");
    const hard = end(true);
    expect(hard.result?.outcome).toBe("fell");
    expect(hard.elapsedMs).toBeLessThan(5_000);
  });

  test("ハードでも、10m のゴールまで行ける入力の列がある。作り直しても同じ結果になる", () => {
    const record = gaitRecord(HARD_GAIT, 60);
    const first = replay(record, { hard: true });
    expect(first.result).toMatchObject({ outcome: "goal" });
    expect(replay(record, { hard: true })).toEqual(first);
  });
});

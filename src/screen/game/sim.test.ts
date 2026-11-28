import { beforeAll, describe, expect, test } from "vite-plus/test";
import type { Joint } from "../../shared/messages.ts";
import { NEUTRAL_INPUTS, STEP_S } from "./body.ts";
import { demoGait as gait } from "./demo.ts";
import { moveInputs } from "./keyboard.ts";
import { OBSTACLE_COURSE, floorHeightAt, type Block } from "./course.ts";
import { GOAL_M, SIT_HEIGHT_M, SIT_MS, Sim, initPhysics } from "./sim.ts";
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

describe("障害物のある Sim", () => {
  test("障害物に当たり判定があり、越えられない高さの壁の手前で止まる", () => {
    const sim = new Sim({ course: [{ kind: "step", x: 2, width: 0.5, height: 0.5 }] });
    run(sim, gait, 30);
    expect(sim.state().distanceM).toBeLessThan(2);
    sim.free();
  });

  test("お手本の歩き方で、障害物モードのハードルと階段を越えてゴールする", () => {
    const sim = new Sim({ course: OBSTACLE_COURSE });
    const s = run(sim, gait, 90);
    expect(s.result).toMatchObject({ outcome: "goal" });
    expect(s.result?.distanceM).toBeGreaterThanOrEqual(GOAL_M);
    sim.free();
  });

  test("階段の上で座り込むと、上の面の高さから測って、転倒と同じに終わる", () => {
    // 2段上った先に、広い上の面（高さ 0.15m）がある
    const top = 0.15;
    const course: Block[] = [
      { kind: "step", x: 2, width: 0.6, height: 0.05 },
      { kind: "step", x: 2.6, width: 0.6, height: 0.1 },
      { kind: "step", x: 3.2, width: 5, height: top },
    ];
    const sim = new Sim({ course });
    // 上の面に上がったら、ひざを曲げて座り込む
    let crouching = false;
    const s = run(
      sim,
      (t) => {
        if (sim.state().poses.torso.x >= 4) crouching = true;
        return crouching ? { ...NEUTRAL, rightKnee: 1, leftKnee: 1 } : gait(t);
      },
      90,
    );
    expect(crouching).toBe(true);
    expect(s.result?.outcome).toBe("fell");
    // 座り込んだのは上の面の上。地面（高さ 0）から測ると、胴は座り込みの高さより上にある
    expect(floorHeightAt(course, s.poses.torso.x)).toBe(top);
    expect(s.poses.torso.y).toBeGreaterThan(SIT_HEIGHT_M);
    sim.free();
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
    { joint: "rightHip", key: "KeyQ" },
    { joint: "rightKnee", key: "KeyO" },
  ] as const)("$joint の反応はプレイ中と1ステップ以内の差に収まる", ({ joint, key }) => {
    // 動き始めを見る。立った姿勢の入力のまま揺れる幅（練習・プレイ中とも 0.0001 rad 未満）より大きくする
    const threshold = 0.0002;
    const stepsToMove = (practice: boolean): number => {
      const sim = practice ? new Sim({ practice: true }) : new Sim();
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
  });

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

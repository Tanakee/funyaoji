import { beforeAll, describe, expect, test } from "vite-plus/test";
import { JOINTS } from "../../shared/messages.ts";
import { NEUTRAL_INPUTS } from "./body.ts";
import { Sim, TIMEOUT_MS, initPhysics } from "./sim.ts";
import type { JointInputs } from "./types.ts";

const NEUTRAL: JointInputs = { ...NEUTRAL_INPUTS };

// 試作（#55）のお手本の歩き方。脚を交互に振る
const GAIT = { T: 2.16, h0: 0.34, A: 0.38, K: 0.76, kp: 0.21 };
const clamp = (x: number) => Math.min(1, Math.max(0, x));
function gait(timeSec: number): JointInputs {
  const out = { ...NEUTRAL };
  for (const j of JOINTS) {
    const ph = (timeSec / GAIT.T) * Math.PI * 2 + (j.startsWith("left") ? Math.PI : 0);
    out[j] = j.endsWith("Hip")
      ? clamp(GAIT.h0 + GAIT.A * Math.sin(ph))
      : clamp(GAIT.K * Math.max(0, Math.sin(ph + GAIT.kp)));
  }
  return out;
}

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

  test("タイムアウトは TIMEOUT_MS で来る", () => {
    const sim = new Sim();
    const s = run(sim, () => NEUTRAL, TIMEOUT_MS / 1000 + 5);
    expect(s.result?.outcome).toBe("timeout");
    expect(s.elapsedMs).toBeGreaterThanOrEqual(TIMEOUT_MS);
    expect(s.elapsedMs).toBeLessThan(TIMEOUT_MS + 100);
    sim.free();
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

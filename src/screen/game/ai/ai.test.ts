import { beforeAll, describe, expect, test } from "vite-plus/test";
import { JOINTS } from "../../../shared/messages.ts";
import { NEUTRAL_INPUTS } from "../body.ts";
import { demoGait } from "../demo.ts";
import { Sim, initPhysics } from "../sim.ts";
import { ACTION_HZ, ACTOR_OBS, CRITIC_EXTRA_OBS, observe, quantize } from "./observe.ts";
import { replay, type InputRecord } from "./record.ts";

beforeAll(initPhysics);

/** お手本の歩き方を、毎秒30回の記録にする */
function demoRecord(seconds: number): InputRecord {
  const inputs: number[][] = [];
  for (let k = 0; k < seconds * ACTION_HZ; k++) {
    const g = demoGait(k / ACTION_HZ);
    inputs.push(JOINTS.map((j) => quantize(g[j])));
  }
  return { hz: ACTION_HZ, joints: JOINTS, inputs };
}

describe("quantize", () => {
  test("0〜1 に収め、1/1000 にそろえる", () => {
    expect([quantize(-1), quantize(2), quantize(0.12345), quantize(Number.NaN)]).toEqual([
      0, 1, 0.123, 0,
    ]);
  });
});

describe("observe", () => {
  test("立った姿勢では、関節の角度が操作しないときの入力と同じ目盛りになる", () => {
    const sim = new Sim();
    const prev = JOINTS.map((j) => NEUTRAL_INPUTS[j]);
    const obs = observe(sim.readout(), prev);
    expect(obs).toHaveLength(ACTOR_OBS + CRITIC_EXTRA_OBS);
    const angles = obs.slice(6, 10);
    JOINTS.forEach((j, i) => expect(angles[i]).toBeCloseTo(NEUTRAL_INPUTS[j], 3));
    // 両足が着き、座り込んでいない。ゴールまでは遠い
    expect(obs.slice(14, 16)).toEqual([1, 1]);
    expect(obs.slice(20)).toEqual([0, 1, 1]);
    sim.free();
  });
});

describe("replay", () => {
  test("記録を再生すると、毎回同じタイムでゴールする", () => {
    const record = demoRecord(40);
    const a = replay(record);
    const b = replay(record);
    expect(a.result).toMatchObject({ outcome: "goal" });
    expect(b.result).toEqual(a.result);
    expect(b.poses).toEqual(a.poses);
  });

  test("毎秒30回の入力なら、最後の1回のほかは、1回で物理が 8 ステップ進む", () => {
    const record = demoRecord(40);
    const times: number[] = [];
    const end = replay(record, {}, (s) => times.push(s.elapsedMs));
    const steps = times.slice(1).map((t, i) => Math.round(((t - times[i]!) * 240) / 1000));
    expect(steps.slice(0, -1).every((n) => n === 8)).toBe(true);
    expect(steps.at(-1)).toBeLessThanOrEqual(8);
    expect(end.elapsedMs).toBe(times.at(-1));
  });

  test("刻みを変えると、別の物理として動く", () => {
    const record = demoRecord(40);
    const fine = replay(record, { stepS: 1 / 480 });
    expect(fine.status).toBe("ended");
    expect(fine.elapsedMs).not.toBe(replay(record).elapsedMs);
  });
});

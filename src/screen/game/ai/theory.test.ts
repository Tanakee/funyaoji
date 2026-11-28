import { beforeAll, expect, test } from "vite-plus/test";
import { JOINTS } from "../../../shared/messages.ts";
import { initPhysics } from "../sim.ts";
import { ACTION_HZ } from "./observe.ts";
import { replay } from "./record.ts";
import theory from "./theory.json";

beforeAll(initPhysics);

// docs/ml.md の「再生の一致を守る」。物理（sim.ts・body.ts・Rapier）を変えて、ここが落ちたら、
// 学習をやり直して記録を作り直す（ml/README.md）。すぐにできないときだけ、理由を書いてこのテストを飛ばす
test("理論値の記録を再生すると、記録したタイムでゴールする", () => {
  const end = replay({ hz: ACTION_HZ, joints: JOINTS, inputs: theory.inputs });
  expect(end.result).toMatchObject({ outcome: "goal", timeMs: theory.timeMs });
});

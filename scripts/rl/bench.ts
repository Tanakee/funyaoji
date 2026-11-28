// 学習の環境の速さを測る。1つのプロセスで、おじさん n 体を、でたらめな行動で steps 回進める。
// 使い方：node scripts/rl/bench.ts [--n 8] [--steps 2000] [--mode normal]
import { parseArgs } from "node:util";
import { DEFAULT_SIM_MODE, toSimMode } from "../../src/screen/game/modes.ts";
import { initPhysics } from "../../src/screen/game/sim.ts";
import { DEFAULT_CONFIG, Env } from "./env.ts";

const { values } = parseArgs({
  options: {
    n: { type: "string", default: "8" },
    steps: { type: "string", default: "2000" },
    mode: { type: "string", default: DEFAULT_SIM_MODE },
  },
});
const n = Number(values.n);
const steps = Number(values.steps);
const config = { ...DEFAULT_CONFIG, mode: toSimMode(values.mode) };

await initPhysics();
const envs = Array.from({ length: n }, () => new Env(config));
let episodes = 0;
const t0 = performance.now();
for (let s = 0; s < steps; s++) {
  for (const e of envs) {
    const r = e.step([0, 1, 2, 3].map(() => Math.random() * 2 - 1));
    if (r.info) {
      episodes++;
      e.reset();
    }
  }
}
const sec = (performance.now() - t0) / 1000;
console.log(
  `${n} 体 × ${steps} ステップ：${sec.toFixed(2)} 秒、毎秒 ${Math.round((n * steps) / sec)} ステップ（エピソード ${episodes}）`,
);

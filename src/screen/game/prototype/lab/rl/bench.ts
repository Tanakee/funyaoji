/// <reference types="node" />
// 試作（あとで捨てる）：強化学習の環境が run.ts と同じ結果になるかを確かめ、速さを測る
//
// 使い方：node src/screen/game/prototype/lab/rl/bench.ts
import { readFileSync } from "node:fs";
import { run, gaitController, gaitInput, JOINTS, NO_NOISE } from "../run.ts";
import { toParams, type Candidate } from "../candidate.ts";
import { Env, DEFAULT_CONFIG } from "./server.ts";

const c = JSON.parse(readFileSync(new URL("./body-b.json", import.meta.url), "utf8")) as Candidate;

// 1. お手本の歩き方を、run.ts（1/60 秒ごとに入力を変える）と、環境（同じく 60Hz にする）で走らせて比べる
const ref = run(toParams(c.params), gaitController(c.gait));
const env = new Env({ ...DEFAULT_CONFIG, params: c.params, actionHz: 60 });
let ended: string | undefined;
let total = 0;
while (!ended) {
  const u = gaitInput(c.gait, env.sim.time, NO_NOISE);
  const r = env.stepInput(JOINTS.map((j) => u[j]));
  total += r.rew;
  ended = r.ended;
}
console.log(`run.ts : ${ref.ended} ${ref.time.toFixed(3)}秒 ${ref.distance.toFixed(3)}m`);
console.log(
  `環境   : ${ended} ${env.sim.time.toFixed(3)}秒 ${env.sim.distance.toFixed(3)}m 報酬の合計 ${total.toFixed(2)}`,
);
console.log(
  ref.ended === ended && Math.abs(ref.time - env.sim.time) < 1e-9 ? "一致" : "一致しない",
);

// 2. 速さ。お手本を 30Hz で動かし、終わったらやり直しながら、決まった数のステップを進める
const e2 = new Env({ ...DEFAULT_CONFIG, params: c.params });
const N = 20000;
const t0 = performance.now();
for (let i = 0; i < N; i++) {
  const u = gaitInput(c.gait, e2.sim.time, NO_NOISE);
  if (e2.stepInput(JOINTS.map((j) => u[j])).ended) e2.reset();
  e2.obs();
}
const sec = (performance.now() - t0) / 1000;
console.log(
  `速さ：1コアで毎秒 ${(N / sec).toFixed(0)} ステップ（30Hz。実時間の ${(N / sec / 30).toFixed(0)} 倍）`,
);

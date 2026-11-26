/// <reference types="node" />
// 試作（あとで捨てる）：フィードバックなしの歩き方（bot.ts の5つの値）で、最速のタイムを探す。強化学習の AI と比べる基準
//
// 使い方：node src/screen/game/prototype/lab/rl/openloop.ts [--body <候補.json>] [--seeds 4] [--gens 60] [--out <書き出す候補.json>]
//   乱数の種を変えて seeds 回探し、それぞれの最速と、全体の最速を出す。--out で、最速の歩き方を入れた候補を書く
//
// 探し方（進化戦略）：今の歩き方のまわりに乱数で 24 個作って走らせ、速かった 6 個の平均を次の中心にする。
// これを gens 回くり返し、乱数の幅を少しずつ狭める。ゴールしない・不自然な動き（sanity）の歩き方は選ばない
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { run, gaitController, sanity, rng, type Gait, type Params } from "../run.ts";
import { toParams, type Candidate } from "../candidate.ts";

/** 探す範囲。T（周期）, h0（ももの中心）, A（ももの振り幅）, K（ひざの曲げ）, kp（ひざのタイミング） */
const LO = [0.3, 0, 0.05, 0, 0];
const HI = [2.4, 1, 1.5, 1, Math.PI * 2];
const POP = 24;
const ELITE = 6;

const r3 = (x: number) => Math.round(x * 1000) / 1000;
// 小数3桁に丸めた値で測る（書き出した値で再生しても、同じ結果になる）
const toGait = (x: number[]): Gait => ({
  T: r3(x[0]!),
  h0: r3(x[1]!),
  A: r3(x[2]!),
  K: r3(x[3]!),
  kp: r3(x[4]!),
});

/** 小さいほど良い。ゴールしたらタイム、しなければ 100 − 進んだ距離 */
function cost(params: Params, g: Gait): number {
  const r = run(params, gaitController(g));
  if (r.ended !== "goal") return 100 - r.distance;
  return r.time + (sanity(params, r).length ? 50 : 0);
}

export function search(
  params: Params,
  start: Gait,
  seed: number,
  gens: number,
): { gait: Gait; time: number } {
  const rnd = rng(seed);
  const gauss = () => Math.sqrt(-2 * Math.log(rnd() + 1e-9)) * Math.cos(2 * Math.PI * rnd());
  let mean = [start.T, start.h0, start.A, start.K, start.kp];
  let best = { gait: toGait(mean), f: cost(params, toGait(mean)) };
  let sigma = 0.25;
  for (let gen = 0; gen < gens; gen++) {
    const pop = Array.from({ length: POP }, () => {
      const x = mean.map((m, i) =>
        Math.min(HI[i]!, Math.max(LO[i]!, m + gauss() * sigma * (HI[i]! - LO[i]!))),
      );
      return { x, f: cost(params, toGait(x)) };
    }).sort((a, b) => a.f - b.f);
    const elite = pop.slice(0, ELITE);
    mean = mean.map((_, i) => elite.reduce((s, e) => s + e.x[i]!, 0) / ELITE);
    if (pop[0]!.f < best.f) best = { gait: toGait(pop[0]!.x), f: pop[0]!.f };
    sigma = Math.max(0.01, sigma * 0.95);
  }
  return { gait: best.gait, time: best.f };
}

if (process.argv[1]?.replace(/\\/g, "/").endsWith("lab/rl/openloop.ts")) {
  const args = process.argv.slice(2);
  let bodyPath = fileURLToPath(new URL("./body-b.json", import.meta.url));
  let seeds = 4;
  let gens = 60;
  let out: string | undefined;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--body") bodyPath = args[++i]!;
    else if (args[i] === "--seeds") seeds = Number(args[++i]);
    else if (args[i] === "--gens") gens = Number(args[++i]);
    else if (args[i] === "--out") out = args[++i];
  }
  const c = JSON.parse(readFileSync(bodyPath, "utf8")) as Candidate;
  const params = toParams(c.params);
  console.log(`今のお手本: ${cost(params, c.gait).toFixed(3)}秒 ${JSON.stringify(c.gait)}`);
  let best: { gait: Gait; time: number } | undefined;
  for (let seed = 1; seed <= seeds; seed++) {
    const r = search(params, c.gait, seed, gens);
    console.log(`種 ${seed}: ${r.time.toFixed(3)}秒 ${JSON.stringify(r.gait)}`);
    if (!best || r.time < best.time) best = r;
  }
  if (best && best.time < 50) {
    console.log(`最速: ${best.time.toFixed(3)}秒 ${JSON.stringify(best.gait)}`);
    if (out) {
      const note = `フィードバックなしの最速（openloop.ts で探した。${best.time.toFixed(3)}秒）`;
      writeFileSync(
        out,
        `${JSON.stringify({ ...c, label: `${c.label} 最速`, note, gait: best.gait }, null, 2)}\n`,
      );
    }
  } else {
    console.log("10m に着く歩き方が見つからなかった");
  }
}

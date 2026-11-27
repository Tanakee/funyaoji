/// <reference types="node" />
// 試作（あとで捨てる）：フィードバックなしの歩き方（bot.ts の5つの値）で、最速のタイムを探す。強化学習の AI と比べる基準
//
// 使い方：node src/screen/game/prototype/lab/rl/openloop.ts [--body <候補.json>] [--seeds 4] [--gens 60] [--out <書き出す候補.json>] [--force]
//   乱数の種を変えて seeds 回探し、それぞれの最速と、全体の最速を出す。--out で、最速の歩き方を入れた候補を書く
//   --out のファイルがすでにあれば、その歩き方を今の体で測り直し、それより速いときだけ書く（--force で必ず書く）
//   10m に着く歩き方が見つからなければ、終了コード 1 で終わる
//
// 探し方（進化戦略）：今の歩き方のまわりに乱数で 24 個作って走らせ、速かった 6 個の平均を次の中心にする。
// これを gens 回くり返し、乱数の幅を少しずつ狭める。ゴールしない・不自然な動き（sanity）の歩き方は選ばない
import { execSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
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

/** cost() の値をログ用の言葉にする。ゴールしたときだけ秒で出す */
function show(f: number): string {
  if (f < 50) return `${f.toFixed(3)}秒`;
  if (f < 90) return `${(f - 50).toFixed(3)}秒（不自然な動きあり）`;
  return `ゴールせず（${(100 - f).toFixed(2)}m）`;
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
  let force = false;
  const fail = (msg: string): never => {
    console.error(msg);
    process.exit(1);
  };
  const value = (i: number): string => args[i] ?? fail(`${args[i - 1]} の値がない`);
  const count = (i: number): number => {
    const n = Number(value(i));
    if (!Number.isInteger(n) || n < 1) fail(`${args[i - 1]} は 1 以上の整数にする（${args[i]}）`);
    return n;
  };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--body") bodyPath = value(++i);
    else if (args[i] === "--seeds") seeds = count(++i);
    else if (args[i] === "--gens") gens = count(++i);
    else if (args[i] === "--out") out = value(++i);
    else if (args[i] === "--force") force = true;
    else fail(`知らない引数: ${args[i]}`);
  }
  const c = JSON.parse(readFileSync(bodyPath, "utf8")) as Candidate;
  const params = toParams(c.params);
  console.log(`今のお手本: ${show(cost(params, c.gait))} ${JSON.stringify(c.gait)}`);
  let best: { gait: Gait; time: number } | undefined;
  for (let seed = 1; seed <= seeds; seed++) {
    const r = search(params, c.gait, seed, gens);
    console.log(`種 ${seed}: ${show(r.time)} ${JSON.stringify(r.gait)}`);
    if (!best || r.time < best.time) best = r;
  }
  if (!best || best.time >= 50) fail("10m に着く歩き方が見つからなかった");
  console.log(`最速: ${best!.time.toFixed(3)}秒 ${JSON.stringify(best!.gait)}`);
  if (out) {
    // 今のファイルの歩き方を、今の体で測り直して比べる。速くなければ書かない
    if (existsSync(out) && !force) {
      const prev = JSON.parse(readFileSync(out, "utf8")) as Candidate;
      const f = cost(params, prev.gait);
      if (f <= best!.time) {
        console.log(
          `${out} の歩き方（今の体で ${show(f)}）より速くないので書かない。上書きするなら --force`,
        );
        process.exit(0);
      }
    }
    const note = `フィードバックなしの最速（openloop.ts で探した。${best!.time.toFixed(3)}秒）`;
    writeFileSync(
      out,
      `${JSON.stringify({ ...c, label: `${c.label} 最速`, note, gait: best!.gait }, null, 2)}\n`,
    );
    // そのままコミットできるように、リポジトリの書式（vp fmt）にそろえる
    const root = fileURLToPath(new URL("../../../../../../", import.meta.url));
    execSync(`npx vp fmt "${resolve(out)}"`, { cwd: root, stdio: ["ignore", "ignore", "inherit"] });
    console.log(`${out} に書いた`);
  }
}

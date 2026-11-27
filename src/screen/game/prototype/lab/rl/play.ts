/// <reference types="node" />
// 試作（あとで捨てる）：学習した AI（policy.json）を1回走らせ、結果を出す。記録も作れる
//
// 使い方：node src/screen/game/prototype/lab/rl/play.ts <policy.json> [--out <記録.json>] [--label <名前>] [--body <候補.json>] [--json] [--trials 16]
//   --trials で、重みをほんの少しずらした AI も走らせ、タイムの中央値を出す。
//   重みが 100 万分の1 違うだけで、途中でつまずくかどうかが変わり、タイムが数秒変わることがある。
//   1回のタイムはたまたまの値なので、AI の良し悪しは中央値で比べる
//   --json で、結果を JSON の1行で出す（ml/ の評価が読む）
//   記録は lab/render.ts で動画にできる
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { neutralInput } from "../../sim.ts";
import { PolicyDriver, type Policy } from "../../policy.ts";
import { toParams, type Candidate } from "../candidate.ts";
import { record, save } from "../record.ts";
import { run, sanity, rng, MAX_TIME, type Controller } from "../run.ts";

const args = process.argv.slice(2);
const policyPath = args[0];
let out: string | undefined;
let label = "AI";
let asJson = false;
let trials = 0;
/** ずらす大きさ。最後の層のバイアスに足す乱数の標準偏差（行動は -1〜1） */
const JITTER = 0.001;
let bodyPath = fileURLToPath(new URL("./body-b.json", import.meta.url));
for (let i = 1; i < args.length; i++) {
  if (args[i] === "--out") out = args[++i];
  else if (args[i] === "--label") label = args[++i]!;
  else if (args[i] === "--body") bodyPath = args[++i]!;
  else if (args[i] === "--json") asJson = true;
  else if (args[i] === "--trials") trials = Number(args[++i]);
}
if (!policyPath) {
  console.error("使い方：play.ts <policy.json> [--out <記録.json>] [--label <名前>]");
  process.exit(1);
}
const policy = JSON.parse(readFileSync(policyPath, "utf8")) as Policy;
const body = JSON.parse(readFileSync(bodyPath, "utf8")) as Candidate;
const params = toParams(body.params);

function controllerOf(p: Policy): Controller {
  let driver: PolicyDriver | undefined;
  return (_time, _noise, sim) => {
    if (!sim) return neutralInput(params.mode);
    driver ??= new PolicyDriver(p, sim);
    return driver.input(sim);
  };
}

/** 最後の層のバイアスを、種から作った乱数で少しずらした AI */
function jittered(p: Policy, seed: number): Policy {
  const rnd = rng(seed);
  const gauss = () => Math.sqrt(-2 * Math.log(rnd() + 1e-9)) * Math.cos(2 * Math.PI * rnd());
  const layers = p.layers.map((l, k) =>
    k === p.layers.length - 1 ? { w: l.w, b: l.b.map((b) => b + gauss() * JITTER) } : l,
  );
  return { ...p, layers };
}

const rec = record(label, params, controllerOf(policy), { note: "強化学習（PPO）" });
const r = rec.result;

// ずらした AI。ゴールしなかった・不自然な動きの走りは、タイムを打ち切りの時間（MAX_TIME）として数える
const runs = Array.from({ length: trials }, (_, k) => {
  const t = run(params, controllerOf(jittered(policy, 7000 + k)));
  const clean = t.ended === "goal" && sanity(params, t).length === 0;
  return { ended: t.ended, time: t.time, clean };
});
const times = runs.map((t) => (t.clean ? t.time : MAX_TIME)).sort((x, y) => x - y);
const summary = {
  cleanRate: runs.length ? runs.filter((t) => t.clean).length / runs.length : undefined,
  median: times.length
    ? (times[Math.floor((times.length - 1) / 2)]! + times[Math.ceil((times.length - 1) / 2)]!) / 2
    : undefined,
  best: times[0],
  worst: times[times.length - 1],
};

if (asJson) {
  console.log(JSON.stringify({ ...r, trials: runs.length, ...summary }));
} else {
  console.log(
    `${label}: ${r.ended} ${r.time.toFixed(3)}秒 ${r.distance.toFixed(2)}m 最大の速さ ${r.peakSpeed.toFixed(1)}m/s 両足が浮いた割合 ${(r.airFrac * 100).toFixed(0)}% ${r.problems.join("、")}`,
  );
  if (runs.length) {
    console.log(
      `少しずらして ${runs.length} 回: 中央値 ${summary.median!.toFixed(3)}秒（最速 ${summary.best!.toFixed(3)}、最遅 ${summary.worst!.toFixed(3)}）、きれいにゴール ${(summary.cleanRate! * 100).toFixed(0)}%`,
    );
  }
}
if (out) save(out, rec);

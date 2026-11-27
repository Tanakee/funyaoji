/// <reference types="node" />
// 試作（あとで捨てる）：学習した AI（policy.json）を1回走らせ、結果を出す。記録も作れる
//
// 使い方：node src/screen/game/prototype/lab/rl/play.ts <policy.json> [--out <記録.json>] [--label <名前>] [--body <候補.json>]
//   記録は lab/render.ts で動画にできる
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { neutralInput } from "../../sim.ts";
import { ACTION_HZ, PolicyDriver, playableActionHz, type Policy } from "../../policy.ts";
import { toParams, type Candidate } from "../candidate.ts";
import { record, save } from "../record.ts";
import type { Controller } from "../run.ts";

const args = process.argv.slice(2);
const policyPath = args[0];
let out: string | undefined;
let label = "AI";
let bodyPath = fileURLToPath(new URL("./body-b.json", import.meta.url));
for (let i = 1; i < args.length; i++) {
  if (args[i] === "--out") out = args[++i];
  else if (args[i] === "--label") label = args[++i]!;
  else if (args[i] === "--body") bodyPath = args[++i]!;
}
if (!policyPath) {
  console.error("使い方：play.ts <policy.json> [--out <記録.json>] [--label <名前>]");
  process.exit(1);
}
const policy = JSON.parse(readFileSync(policyPath, "utf8")) as Policy;
// run() は 1/60 秒ごとにしか AI を呼ばないので、学習と同じ間隔で行動を変えられない頻度は再生しない
if (!playableActionHz(policy.actionHz ?? ACTION_HZ)) {
  console.error(
    `actionHz ${policy.actionHz} の重みは、この再生（1/60 秒ごと）では学習と同じ間隔にならない`,
  );
  process.exit(1);
}
const body = JSON.parse(readFileSync(bodyPath, "utf8")) as Candidate;
const params = toParams(body.params);

let driver: PolicyDriver | undefined;
const controller: Controller = (_time, _noise, sim) => {
  if (!sim) return neutralInput(params.mode);
  driver ??= new PolicyDriver(policy, sim);
  return driver.input(sim);
};
const rec = record(label, params, controller, { note: "強化学習（PPO）" });
const r = rec.result;
console.log(
  `${label}: ${r.ended} ${r.time.toFixed(3)}秒 ${r.distance.toFixed(2)}m 最大の速さ ${r.peakSpeed.toFixed(1)}m/s 両足が浮いた割合 ${(r.airFrac * 100).toFixed(0)}% ${r.problems.join("、")}`,
);
if (out) save(out, rec);

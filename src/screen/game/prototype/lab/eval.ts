/// <reference types="node" />
// 試作（あとで捨てる）：候補の設定を測り、ずれに強い歩き方を探して、候補の JSON に書き戻す
//
// 使い方：node src/screen/game/prototype/lab/eval.ts <候補.json> [--out <書き出す候補.json>] [--gaits 300]
//   候補の gait は無視して、歩き方を探し直す。--out を付けると、見つかった歩き方と計測の結果を入れた候補を書く
import { readFileSync, writeFileSync } from "node:fs";
import { evaluate, summary } from "./run.ts";
import { toParams, type Candidate } from "./candidate.ts";

const args = process.argv.slice(2);
const inPath = args[0];
let out: string | undefined;
let gaits = 300;
for (let i = 1; i < args.length; i++) {
  if (args[i] === "--out") out = args[++i];
  else if (args[i] === "--gaits") gaits = Number(args[++i]);
}
if (!inPath) {
  console.error("使い方：eval.ts <候補.json> [--out <書き出す候補.json>] [--gaits 300]");
  process.exit(1);
}
const c = JSON.parse(readFileSync(inPath, "utf8")) as Candidate;
const t0 = Date.now();
const e = evaluate(toParams(c.params), { gaits });
console.log(`${summary(c.label, e)} | ${((Date.now() - t0) / 1000).toFixed(0)}秒`);
if (out && e.best) {
  writeFileSync(out, JSON.stringify({ ...c, gait: e.best.gait, evaluation: e }, null, 2));
}

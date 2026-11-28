// 理論値の記録（src/screen/game/ai/theory.json）が、今の物理でも使えるかを確かめる（docs/ml.md の「再生の一致を守る」）。
// 次のどちらかなら「変わった」とし、学習をやり直して記録を作り直す。
// - 今の物理の指紋が、記録を作ったときの指紋と違う
// - 記録を今の物理で再生すると、記録したタイムでゴールしない（指紋に入らない変わり方でも気づけるように）
//
// 使い方：node scripts/rl/fingerprint.ts [--theory <記録.json>] [--github-output] [--expect-unchanged]
//   {"current":"...","recorded":"...","rapier":"...","replay":{...},"reasons":[...],"changed":true} を出す。
//   --theory：theory.json の代わりに、この記録を確かめる
//   --github-output：GitHub Actions の出力に changed=true|false と fingerprint=<今の指紋> を書く
//   --expect-unchanged：変わっていたら、終了コード 1 で終わる
import { appendFileSync, readFileSync } from "node:fs";
import { JOINTS } from "../../src/shared/messages.ts";
import { ACTION_HZ } from "../../src/screen/game/ai/observe.ts";
import { replay } from "../../src/screen/game/ai/record.ts";
import { initPhysics } from "../../src/screen/game/sim.ts";
import { physicsFingerprint } from "./env.ts";

const args = process.argv.slice(2);
const at = args.indexOf("--theory");
const path =
  at >= 0 ? args[at + 1] : new URL("../../src/screen/game/ai/theory.json", import.meta.url);
if (!path) throw new Error("--theory のあとに記録のファイルを渡す");

await initPhysics();
const { fingerprint, rapier } = physicsFingerprint();
const theory = JSON.parse(readFileSync(path, "utf-8")) as {
  physicsFingerprint?: string;
  timeMs?: number;
  inputs?: number[][];
};

const reasons: string[] = [];
if (theory.physicsFingerprint !== fingerprint) {
  reasons.push(`物理の指紋が違う（記録 ${theory.physicsFingerprint} → 今 ${fingerprint}）`);
}
const end = replay({ hz: ACTION_HZ, joints: JOINTS, inputs: theory.inputs ?? [] });
if (end.result?.outcome !== "goal" || end.result.timeMs !== theory.timeMs) {
  const got =
    end.result?.outcome === "goal"
      ? `${end.result.timeMs} ms でゴールした`
      : `結果：${end.result?.outcome ?? "終わらない"}`;
  reasons.push(`記録を再生すると、記録したタイム（${theory.timeMs} ms）でゴールしない（${got}）`);
}
const changed = reasons.length > 0;
console.log(
  JSON.stringify({
    current: fingerprint,
    recorded: theory.physicsFingerprint,
    rapier,
    replay: end.result ?? null,
    reasons,
    changed,
  }),
);
for (const r of reasons) console.log(`変わった：${r}`);

const out = process.env.GITHUB_OUTPUT;
if (args.includes("--github-output") && out) {
  appendFileSync(out, `changed=${changed}\nfingerprint=${fingerprint}\n`);
}
if (args.includes("--expect-unchanged") && changed) process.exitCode = 1;

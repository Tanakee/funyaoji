// 今の物理の指紋を出し、理論値の記録（src/screen/game/ai/theory.json）を作ったときの指紋と比べる。
// 違っていれば、物理が変わったので、学習をやり直して記録を作り直す（docs/ml.md の「再生の一致を守る」）。
//
// 使い方：node scripts/rl/fingerprint.ts [--github-output]
//   {"current":"...","recorded":"...","rapier":"...","changed":true} を出す。
//   --github-output を付けると、GitHub Actions の出力に changed=true|false を書く
import { appendFileSync, readFileSync } from "node:fs";
import { initPhysics } from "../../src/screen/game/sim.ts";
import { physicsFingerprint } from "./env.ts";

await initPhysics();
const { fingerprint, rapier } = physicsFingerprint();
const theory = JSON.parse(
  readFileSync(new URL("../../src/screen/game/ai/theory.json", import.meta.url), "utf-8"),
) as { physicsFingerprint?: string };
const changed = theory.physicsFingerprint !== fingerprint;
console.log(
  JSON.stringify({ current: fingerprint, recorded: theory.physicsFingerprint, rapier, changed }),
);

const out = process.env.GITHUB_OUTPUT;
if (process.argv.includes("--github-output") && out) {
  appendFileSync(out, `changed=${changed}\nfingerprint=${fingerprint}\n`);
}

// 理論値の記録（src/screen/game/ai/theory/<モード>.json）が、今の物理でも使えるかを、モードごとに確かめる
// （docs/ml.md の「再生の一致を守る」）。モードは src/screen/game/modes.ts の一覧から回る。
// 次のどれかなら、そのモードは「変わった」とし、学習をやり直して記録を作り直す。
// - 記録が無い（一覧にモードを足したばかり）
// - 今の物理の指紋が、記録を作ったときの指紋と違う
// - 記録を今の物理で再生すると、記録したタイムでゴールしない（指紋に入らない変わり方でも気づけるように）
//
// 使い方：node scripts/rl/fingerprint.ts [--mode <モード>] [--theory <記録.json>] [--github-output] [--expect-unchanged]
//   モードごとに1行、{"mode":"normal","current":"...","recorded":"...","rapier":"...","replay":{...},"reasons":[...],"changed":true} を出す。
//   --mode：このモードだけを確かめる。省くと、一覧の全部のモード
//   --theory：theory/<モード>.json の代わりに、この記録を確かめる。--mode で記録のモードを渡す（省くとノーマル）
//   --github-output：GitHub Actions の出力に、次を JSON で書く
//     modes=["normal",...]（確かめたモード）、changed=["normal",...]（変わったモード）、fingerprints={"normal":"<今の指紋>",...}
//   --expect-unchanged：どれかのモードが変わっていたら、終了コード 1 で終わる
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { JOINTS } from "../../src/shared/messages.ts";
import { ACTION_HZ } from "../../src/screen/game/ai/observe.ts";
import { replay } from "../../src/screen/game/ai/record.ts";
import {
  DEFAULT_SIM_MODE,
  SIM_MODES,
  modeSimOptions,
  toSimMode,
  type SimMode,
} from "../../src/screen/game/modes.ts";
import { initPhysics } from "../../src/screen/game/sim.ts";
import { physicsFingerprint } from "./env.ts";

const { values } = parseArgs({
  options: {
    mode: { type: "string" },
    theory: { type: "string" },
    "github-output": { type: "boolean", default: false },
    "expect-unchanged": { type: "boolean", default: false },
  },
});
// --theory を付けてモードを省いたときは、ノーマルの記録として確かめる（モードを分ける前と同じ使い方）
const modes: SimMode[] =
  values.mode !== undefined
    ? [toSimMode(values.mode)]
    : values.theory !== undefined
      ? [DEFAULT_SIM_MODE]
      : SIM_MODES;

/** モードの理論値の記録の場所 */
function theoryPath(mode: SimMode): string | URL {
  return values.theory ?? new URL(`../../src/screen/game/ai/theory/${mode}.json`, import.meta.url);
}

interface Check {
  mode: SimMode;
  current: string;
  recorded: string | undefined;
  rapier: string;
  replay: unknown;
  reasons: string[];
  changed: boolean;
}

function check(mode: SimMode): Check {
  const { fingerprint, rapier } = physicsFingerprint(mode);
  const path = theoryPath(mode);
  const reasons: string[] = [];
  if (!existsSync(path)) {
    reasons.push("理論値の記録が無い");
    return {
      mode,
      current: fingerprint,
      recorded: undefined,
      rapier,
      replay: null,
      reasons,
      changed: true,
    };
  }
  const theory = JSON.parse(readFileSync(path, "utf-8")) as {
    physicsFingerprint?: string;
    timeMs?: number;
    inputs?: number[][];
  };
  if (theory.physicsFingerprint !== fingerprint) {
    reasons.push(`物理の指紋が違う（記録 ${theory.physicsFingerprint} → 今 ${fingerprint}）`);
  }
  const end = replay(
    { hz: ACTION_HZ, joints: JOINTS, inputs: theory.inputs ?? [] },
    modeSimOptions(mode),
  );
  if (end.result?.outcome !== "goal" || end.result.timeMs !== theory.timeMs) {
    const got =
      end.result?.outcome === "goal"
        ? `${end.result.timeMs} ms でゴールした`
        : `結果：${end.result?.outcome ?? "終わらない"}`;
    reasons.push(`記録を再生すると、記録したタイム（${theory.timeMs} ms）でゴールしない（${got}）`);
  }
  return {
    mode,
    current: fingerprint,
    recorded: theory.physicsFingerprint,
    rapier,
    replay: end.result ?? null,
    reasons,
    changed: reasons.length > 0,
  };
}

await initPhysics();
const checks = modes.map(check);
for (const c of checks) {
  console.log(JSON.stringify(c));
  for (const r of c.reasons) console.log(`変わった（${c.mode}）：${r}`);
}

const out = process.env.GITHUB_OUTPUT;
if (values["github-output"] && out) {
  const changed = checks.filter((c) => c.changed).map((c) => c.mode);
  const fingerprints = Object.fromEntries(checks.map((c) => [c.mode, c.current]));
  appendFileSync(
    out,
    `modes=${JSON.stringify(modes)}\nchanged=${JSON.stringify(changed)}\nfingerprints=${JSON.stringify(fingerprints)}\n`,
  );
}
if (values["expect-unchanged"] && checks.some((c) => c.changed)) process.exitCode = 1;

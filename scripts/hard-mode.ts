// ハードモードのモーターの値を決めるために、ノーマルとハードで決まった歩き方を再生して比べる（docs/game.md の「ハードモード」）。
// お手本の歩き方と、周期・振幅などをでたらめに変えた歩き方（種を固定）を、ノーマルと、モーターの候補ごとのハードで再生し、
// ゴールした数・転んだ時刻・進んだ距離を表にする。体の状態を見ない、時間だけで決まる入力なので、人が見て直す操作より厳しい
// 使い方：node scripts/hard-mode.ts [--n 1500] [--seed 7]
//   1500 通りで30分ほどかかる（ノーマルは転ばずに60秒歩き続ける歩き方が多く、その分が長い）
import { parseArgs } from "node:util";
import { DEMO_GAIT, type Gait, gaitRecord } from "../src/screen/game/ai/gait.ts";
import { replay } from "../src/screen/game/ai/record.ts";
import { HARD_MOTOR, MOTOR } from "../src/screen/game/body.ts";
import { initPhysics, type SimState } from "../src/screen/game/sim.ts";

const { values: args } = parseArgs({
  options: { n: { type: "string", default: "1500" }, seed: { type: "string", default: "7" } },
});
const LIMIT_S = 60;

/** 比べるハードのモーターの候補。HARD_MOTOR を書き換えて再生する */
const CANDIDATES: (typeof MOTOR)[] = [
  { ...MOTOR },
  { ...MOTOR, maxForceBodyWeights: 0.16 },
  { ...MOTOR, maxForceBodyWeights: 0.14 },
  { ...MOTOR, maxForceBodyWeights: 0.12 },
  { ...MOTOR, maxForceBodyWeights: 0.1 },
  { stiffness: 600, damping: 90, maxForceBodyWeights: 0.14 },
  { stiffness: 1000, damping: 108, maxForceBodyWeights: 0.14 },
];

// 歩き方の値の範囲。お手本（T 2.16・h0 0.34・A 0.38・K 0.76・kp 0.21）を囲み、胴を前に傾ける h0 の大きい側に広げる
let seed = Number(args.seed);
const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
const U = (a: number, b: number) => a + (b - a) * rnd();
const gaits: Gait[] = Array.from({ length: Number(args.n) }, () => ({
  T: U(1, 3.5),
  h0: U(0.25, 0.75),
  A: U(0.05, 0.45),
  K: U(0.2, 1),
  kp: U(-0.8, 1.2),
}));

await initPhysics();

const play = (gait: Gait, hard: boolean): SimState => replay(gaitRecord(gait, LIMIT_S), { hard });
const describe = (end: SimState): string => {
  const r = end.result;
  if (r?.outcome === "goal") return `ゴール ${(r.timeMs / 1000).toFixed(2)} 秒`;
  if (r?.outcome === "fell")
    return `${(end.elapsedMs / 1000).toFixed(2)} 秒で転倒・${r.distanceM.toFixed(2)} m`;
  return `${LIMIT_S} 秒で終わらない・${end.distanceM.toFixed(2)} m`;
};
/** 中央値。件数が偶数のときは、中央の2つの平均 */
const median = (xs: number[]): number => {
  if (xs.length === 0) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
};
const fmt = (g: Gait) =>
  `T ${g.T.toFixed(2)}・h0 ${g.h0.toFixed(2)}・A ${g.A.toFixed(2)}・K ${g.K.toFixed(2)}・kp ${g.kp.toFixed(2)}`;

function row(name: string, hard: boolean): void {
  const demo = play(DEMO_GAIT, hard);
  const ends = gaits.map((g) => play(g, hard));
  const goalMs = (s: SimState) => (s.result?.outcome === "goal" ? s.result.timeMs : Infinity);
  const goals = ends.filter((s) => s.result?.outcome === "goal");
  const fell = ends.filter((s) => s.result?.outcome === "fell");
  let fastest = -1;
  ends.forEach((s, i) => {
    if (goalMs(s) < (fastest < 0 ? Infinity : goalMs(ends[fastest]!))) fastest = i;
  });
  console.log(
    [
      `| ${name}`,
      describe(demo),
      `${goals.length}`,
      `${fell.length}`,
      `${(median(fell.map((s) => s.elapsedMs)) / 1000).toFixed(2)} 秒`,
      `${median(ends.map((s) => s.distanceM)).toFixed(2)} m`,
      fastest < 0 ? "なし" : `${describe(ends[fastest]!)}（${fmt(gaits[fastest]!)}）`,
    ].join(" | ") + " |",
  );
}

console.log(`歩き方 ${gaits.length} 通り（種 ${args.seed}）、${LIMIT_S} 秒まで`);
console.log(
  "| 物理 | お手本 | ゴール | 転倒 | 転んだ時刻の中央値 | 進んだ距離の中央値 | いちばん速いゴール |",
);
console.log("|---|---|---|---|---|---|---|");
row("ノーマル", false);
for (const c of CANDIDATES) {
  Object.assign(HARD_MOTOR, c);
  row(
    `ハード stiffness ${c.stiffness}・damping ${c.damping}・maxForce ${c.maxForceBodyWeights}`,
    true,
  );
}

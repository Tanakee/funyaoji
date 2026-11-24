/// <reference types="node" />
// 試作（あとで捨てる）：候補（設定＋歩き方）の JSON を読み書きし、記録を作る
//
// 使い方：node src/screen/game/prototype/lab/candidate.ts <候補.json> <出力の記録.json> [--noise mid --seed 3]
//   --noise を付けると、4人の息の合わなさ（ずれ）を足して走らせる
import { readFileSync } from "node:fs";
import {
  DEFAULT_PARAMS,
  DEFAULT_BODY,
  gaitController,
  makeNoise,
  NOISE_LEVELS,
  type Gait,
  type NoiseLevel,
  type Params,
} from "./run.ts";
import { record, save } from "./record.ts";

/** 候補。params は DEFAULT_PARAMS との差分だけ書く（body も差分でよい） */
export interface Candidate {
  label: string;
  note?: string;
  params: Partial<Omit<Params, "body">> & { body?: DeepPartial<Params["body"]> };
  gait: Gait;
}

type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends object ? (T[K] extends unknown[] ? T[K] : DeepPartial<T[K]>) : T[K];
};

export function toParams(c: Candidate["params"]): Params {
  const body = structuredClone(DEFAULT_BODY) as unknown as Record<string, unknown>;
  for (const [k, v] of Object.entries(c.body ?? {})) {
    body[k] = Array.isArray(v) || typeof v !== "object" ? v : { ...(body[k] as object), ...v };
  }
  return { ...DEFAULT_PARAMS, ...c, body: body as unknown as Params["body"] };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [inPath, outPath, ...rest] = process.argv.slice(2);
  if (!inPath || !outPath) {
    console.error("使い方：candidate.ts <候補.json> <出力の記録.json> [--noise mid --seed 3]");
    process.exit(1);
  }
  let level: NoiseLevel | undefined;
  let seed = 1;
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === "--noise") level = rest[++i] as NoiseLevel;
    else if (rest[i] === "--seed") seed = Number(rest[++i]);
  }
  const c = JSON.parse(readFileSync(inPath, "utf8")) as Candidate;
  const noise = level
    ? makeNoise(1000 + seed * 31, NOISE_LEVELS[level].delay, NOISE_LEVELS[level].scale)
    : undefined;
  const label = level
    ? `${c.label}（ずれ${{ small: "小", mid: "中", large: "大" }[level]}・${seed}回目）`
    : c.label;
  const rec = record(label, toParams(c.params), gaitController(c.gait), {
    noise,
    note: c.note,
    controllerInfo: c.gait,
  });
  save(outPath, rec);
  console.log(
    `${label}: ${rec.result.ended} ${rec.result.time.toFixed(1)}秒 ${rec.result.distance.toFixed(1)}m ${rec.result.problems.join("、")}`,
  );
}

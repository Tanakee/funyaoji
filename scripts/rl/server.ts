// 強化学習の環境のサーバー。おじさんを n 体持ち、標準入力の1行（JSON）ごとに処理して、1行で返す。
// Python（ml/funyaoji_rl/vec_env.py）が、このプロセスを CPU のコアの数だけ並べる。
//
// 1つのプロセスは、1つのモード（src/screen/game/modes.ts の一覧）だけを扱う。どのコマンドも、そのモードの設定の Sim で動く。
//
// 使い方：node scripts/rl/server.ts [--mode normal]
//   --mode：モード。省くとノーマル
//   {"cmd":"init","n":8,"config":{...}}   → {"obs":[[...], ...], "obsDim":23, "actorObs":22, "mode":"normal", "fingerprint":"...", "rapier":"0.21.0", "shapes":{...}}
//   {"cmd":"step","a":[[a,a,a,a], ...]}   → {"obs":..., "rew":[...], "done":[...], "info":[...]}
//   {"cmd":"replay","inputs":[[u,u,u,u], ...]} → {"frames":[{poses}...], "result":{...}, "elapsedMs":...}
//   {"cmd":"check","inputs":[[u,u,u,u], ...]} → {"jointOvershoot", "penetration", "jump", "peakSpeed", ...}（物理の不具合の量）
//   {"cmd":"gait","gaits":[{T,h0,A,K,kp}, ...]} → {"results":[{"outcome","timeMs","distanceM"}, ...]}（決まった歩き方を走らせる）
//   行動 a は AI の出力（-1〜1 が4つ、JOINTS の順）。終わったおじさんは、その場で最初からやり直す。
//   obs はやり直したあとの観測で、終わる直前の観測は info.final に入る
import { createInterface } from "node:readline";
import { parseArgs } from "node:util";
import { JOINTS } from "../../src/shared/messages.ts";
import { PART_SHAPES } from "../../src/screen/game/body.ts";
import { ACTION_HZ, CRITIC_EXTRA_OBS } from "../../src/screen/game/ai/observe.ts";
import { gaitRecord, type Gait } from "../../src/screen/game/ai/gait.ts";
import { measure } from "./anomaly.ts";
import { replay } from "../../src/screen/game/ai/record.ts";
import { DEFAULT_SIM_MODE, modeSimOptions, toSimMode } from "../../src/screen/game/modes.ts";
import { initPhysics } from "../../src/screen/game/sim.ts";
import {
  DEFAULT_CONFIG,
  Env,
  actorObs,
  physicsFingerprint,
  type EnvConfig,
  type EpisodeInfo,
} from "./env.ts";

const { values } = parseArgs({
  options: { mode: { type: "string", default: DEFAULT_SIM_MODE } },
});
const mode = toSimMode(values.mode);
const simOptions = modeSimOptions(mode);

await initPhysics();

let envs: Env[] = [];

interface Message {
  cmd: string;
  n?: number;
  // mode は一覧に無い名前も届きうるので、文字列で受けて確かめる
  config?: Omit<Partial<EnvConfig>, "mode"> & { mode?: string };
  a?: number[][];
  inputs?: number[][];
  stepS?: number;
  gaits?: Gait[];
  withInputs?: boolean;
}

/** 決まった歩き方を走らせる時間の上限（秒）。学習の上限時間と同じ */
const GAIT_MAX_S = DEFAULT_CONFIG.maxTimeS;

function handle(msg: Message): unknown {
  if (msg.cmd === "init") {
    for (const e of envs) e.free();
    // モードはプロセスで決める（--mode）。config で別のモードを渡されたら止める
    if (msg.config?.mode !== undefined && msg.config.mode !== mode) {
      throw new Error(`このプロセスのモードは ${mode}。config.mode（${msg.config.mode}）とは違う`);
    }
    const cfg: EnvConfig = { ...DEFAULT_CONFIG, ...msg.config, mode };
    envs = Array.from({ length: msg.n ?? 1 }, () => new Env(cfg));
    return {
      obs: envs.map((e) => e.obs()),
      obsDim: actorObs(cfg) + CRITIC_EXTRA_OBS,
      actorObs: actorObs(cfg),
      mode,
      ...physicsFingerprint(mode),
      shapes: PART_SHAPES,
    };
  }
  if (msg.cmd === "step") {
    const obs: number[][] = [];
    const rew: number[] = [];
    const done: boolean[] = [];
    const info: (EpisodeInfo | null)[] = [];
    envs.forEach((e, i) => {
      const r = e.step(msg.a![i]!);
      rew.push(r.reward);
      done.push(r.info !== undefined);
      info.push(r.info ?? null);
      obs.push(r.info ? e.reset() : e.obs());
    });
    return { obs, rew, done, info };
  }
  if (msg.cmd === "replay") {
    const frames: unknown[] = [];
    const end = replay(
      { hz: ACTION_HZ, joints: JOINTS, inputs: msg.inputs ?? [] },
      msg.stepS === undefined ? simOptions : { ...simOptions, stepS: msg.stepS },
      (s) => frames.push({ poses: s.poses, distanceM: s.distanceM, elapsedMs: s.elapsedMs }),
    );
    return {
      frames,
      result: end.result ?? null,
      elapsedMs: end.elapsedMs,
      distanceM: end.distanceM,
    };
  }
  if (msg.cmd === "gait") {
    const results = (msg.gaits ?? []).map((g) => {
      const record = gaitRecord(g, GAIT_MAX_S);
      const end = replay(record, simOptions);
      const outcome = end.result?.outcome ?? "timeout";
      return {
        outcome,
        timeMs: end.result?.outcome === "goal" ? end.result.timeMs : null,
        distanceM: end.distanceM,
        // 終わったところまでの入力
        inputs: msg.withInputs
          ? record.inputs.slice(0, Math.ceil((end.elapsedMs / 1000) * ACTION_HZ - 1e-9))
          : undefined,
      };
    });
    return { results };
  }
  if (msg.cmd === "check") {
    // 記録を物理の1ステップずつ再生し、不具合の量を測る（anomaly.ts）
    return measure({ hz: ACTION_HZ, joints: JOINTS, inputs: msg.inputs ?? [] }, mode);
  }
  throw new Error(`知らない cmd: ${msg.cmd}`);
}

const rl = createInterface({ input: process.stdin });
rl.on("line", (line) => {
  if (!line.trim()) return;
  process.stdout.write(`${JSON.stringify(handle(JSON.parse(line) as Message))}\n`);
});

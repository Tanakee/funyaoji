// 強化学習の環境のサーバー。おじさんを n 体持ち、標準入力の1行（JSON）ごとに処理して、1行で返す。
// Python（ml/funyaoji_rl/vec_env.py）が、このプロセスを CPU のコアの数だけ並べる。
//
// 使い方：node scripts/rl/server.ts
//   {"cmd":"init","n":8,"config":{...}}   → {"obs":[[...], ...], "obsDim":23, "actorObs":22, "fingerprint":"...", "rapier":"0.21.0", "shapes":{...}}
//   {"cmd":"step","a":[[a,a,a,a], ...]}   → {"obs":..., "rew":[...], "done":[...], "info":[...]}
//   {"cmd":"replay","inputs":[[u,u,u,u], ...]} → {"frames":[{poses}...], "result":{...}, "elapsedMs":...}
//   行動 a は AI の出力（-1〜1 が4つ、JOINTS の順）。終わったおじさんは、その場で最初からやり直す。
//   obs はやり直したあとの観測で、終わる直前の観測は info.final に入る
import { createInterface } from "node:readline";
import { JOINTS } from "../../src/shared/messages.ts";
import { PART_SHAPES } from "../../src/screen/game/body.ts";
import { ACTION_HZ, ACTOR_OBS, CRITIC_EXTRA_OBS } from "../../src/screen/game/ai/observe.ts";
import { replay } from "../../src/screen/game/ai/record.ts";
import { initPhysics } from "../../src/screen/game/sim.ts";
import {
  DEFAULT_CONFIG,
  Env,
  physicsFingerprint,
  type EnvConfig,
  type EpisodeInfo,
} from "./env.ts";

await initPhysics();

let envs: Env[] = [];

interface Message {
  cmd: string;
  n?: number;
  config?: Partial<EnvConfig>;
  a?: number[][];
  inputs?: number[][];
  stepS?: number;
}

function handle(msg: Message): unknown {
  if (msg.cmd === "init") {
    for (const e of envs) e.free();
    const cfg = { ...DEFAULT_CONFIG, ...msg.config };
    envs = Array.from({ length: msg.n ?? 1 }, () => new Env(cfg));
    return {
      obs: envs.map((e) => e.obs()),
      obsDim: ACTOR_OBS + CRITIC_EXTRA_OBS,
      actorObs: ACTOR_OBS,
      ...physicsFingerprint(),
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
      msg.stepS === undefined ? {} : { stepS: msg.stepS },
      (s) => frames.push({ poses: s.poses, distanceM: s.distanceM, elapsedMs: s.elapsedMs }),
    );
    return {
      frames,
      result: end.result ?? null,
      elapsedMs: end.elapsedMs,
      distanceM: end.distanceM,
    };
  }
  throw new Error(`知らない cmd: ${msg.cmd}`);
}

const rl = createInterface({ input: process.stdin });
rl.on("line", (line) => {
  if (!line.trim()) return;
  process.stdout.write(`${JSON.stringify(handle(JSON.parse(line) as Message))}\n`);
});

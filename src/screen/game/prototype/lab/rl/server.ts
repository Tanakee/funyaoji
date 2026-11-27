/// <reference types="node" />
// 試作（あとで捨てる）：強化学習の環境。おじさんを n 体持ち、標準入力の1行（JSON）ごとに全員を1ステップ進める
//
// 使い方：node src/screen/game/prototype/lab/rl/server.ts
//   {"cmd":"init","n":8,"config":{...}}      → {"obs":[[...], ...]}
//   {"cmd":"step","a":[[a,a,a,a], ...]}      → {"obs":..., "rew":[...], "done":[...], "info":[...]}
//   行動 a は AI の出力（-1〜1 が4つ）。順番は JOINTS（右もも・左もも・右ひざ・左ひざ）。
//   関節の入力（0〜1）には、policy.ts の toInput で直す（ブラウザで再生するときと同じ計算）
//   終わったおじさんは、その場で最初からやり直す。obs はやり直したあとの観測で、終わる直前の観測は info.final に入る
import { createInterface } from "node:readline";
import { Sim, JOINTS, GOAL_M, footContact, sanity, standingTorsoY, type Params } from "../run.ts";
import { toParams, type Candidate } from "../candidate.ts";
import { neutralInput, type JointName } from "../../sim.ts";
import {
  observe,
  obsDim,
  toInput,
  ACTION_HZ,
  actionSteps,
  playableActionHz,
  type Base,
} from "../../policy.ts";

export interface EnvConfig {
  /** 体と操作の設定。DEFAULT_PARAMS との差分 */
  params: Candidate["params"];
  /** 土台の歩き方。入れると、行動は、この歩き方の入力に足す補正になる（policy.ts の Base） */
  base?: Base;
  /**
   * 行動を変える頻度（1秒あたり）。スマホの tilt と同じ 30 が標準。重みの JSON にも書き、再生で同じ頻度にする。
   * 物理の 240 ステップを割った間隔が 4 の倍数になる値だけ（60・30・20・15・12・10 など）。play.ts で同じ間隔で再生できないため
   */
  actionHz: number;
  /** 打ち切る時間（秒） */
  maxTime: number;
  /** この秒数のあいだに 0.3m 進まなければ打ち切る。0 で無し */
  stuckTime: number;
  /** 報酬：前に 1m 進むごと */
  wForward: number;
  /** 報酬：1秒たつごと（負の値で、速いほど得になる） */
  wTime: number;
  /** 報酬：ゴール・転倒 */
  goalBonus: number;
  fallPenalty: number;
  /** 報酬：行動を前のステップから変えた量（負の値で、がたがた動かさなくなる） */
  wSmooth: number;
  /** 報酬：両足が浮いているステップ（負の値で、跳ねなくなる） */
  wAir: number;
  /** 胴がこの高さ（立った姿勢より上、m）を超えたら、転倒と同じ扱いで終わる（ゴールより先に見る）。0 で無し */
  maxJump: number;
  /** 前に進む報酬を数える速さの上限（m/s）。0 で無し */
  speedCap: number;
}

export const DEFAULT_CONFIG: EnvConfig = {
  params: {},
  actionHz: ACTION_HZ,
  maxTime: 30,
  stuckTime: 6,
  wForward: 1,
  wTime: -0.5,
  goalBonus: 5,
  fallPenalty: -5,
  wSmooth: 0,
  wAir: 0,
  maxJump: 0,
  speedCap: 0,
};

type Ended = "goal" | "fell" | "stuck" | "timeout" | "jump";

interface EpisodeInfo {
  ended: Ended;
  time: number;
  distance: number;
  /** sanity() で引っかかった数。0 なら不自然な動きなし */
  problems: number;
  airFrac: number;
  peakSpeed: number;
  final: number[];
}

class Env {
  sim!: Sim;
  private prev!: number[];
  private lastX = 0;
  private progressX = 0;
  private progressT = 0;
  private peakSpeed = 0;
  private maxTorsoY = 0;
  private air = 0;
  private steps = 0;
  private readonly params: Params;
  private readonly sub: number;
  private readonly stand: number;
  private readonly cfg: EnvConfig;

  constructor(cfg: EnvConfig) {
    this.cfg = cfg;
    this.params = toParams(cfg.params);
    this.sub = actionSteps(cfg.actionHz);
    this.stand = standingTorsoY(this.params);
    this.reset();
  }

  reset(): number[] {
    // 古い Sim の World を返さないと、1話ごとに WebAssembly のメモリが残る
    this.sim?.free();
    this.sim = new Sim(this.params);
    const n = neutralInput(this.params.mode);
    this.prev = JOINTS.map((j) => n[j]);
    this.lastX = 0;
    this.progressX = 0;
    this.progressT = 0;
    this.peakSpeed = 0;
    this.maxTorsoY = 0;
    this.air = 0;
    this.steps = 0;
    return this.obs();
  }

  obs(): number[] {
    return observe(this.sim, this.prev, this.cfg.base);
  }

  /** AI の出力（-1〜1）で1ステップ進める */
  step(a: number[]): { rew: number; ended?: Ended } {
    return this.stepInput(toInput(a, this.sim.time, this.cfg.base));
  }

  /** 関節の入力（0〜1）で1ステップ進める */
  stepInput(input01: number[]): { rew: number; ended?: Ended } {
    const cfg = this.cfg;
    const s = this.sim;
    const u = input01.map((x) => Math.min(1, Math.max(0, x)));
    const input = {} as Record<JointName, number>;
    JOINTS.forEach((j, i) => (input[j] = u[i]!));
    let airSteps = 0;
    let jumped = false;
    let k = 0;
    // 跳んだらそこで止める。同じ区間で 10m に着いても、ゴールにしない
    for (; k < this.sub && !s.ended && !jumped; k++) {
      s.step(input);
      this.steps++;
      this.peakSpeed = Math.max(this.peakSpeed, Math.abs(s.torso.linvel().x));
      const y = s.torso.translation().y;
      this.maxTorsoY = Math.max(this.maxTorsoY, y);
      if (cfg.maxJump > 0 && y > this.stand + cfg.maxJump) jumped = true;
      if (!footContact(s).some(Boolean)) {
        this.air++;
        airSteps++;
      }
    }
    // 途中で終わったときは、実際に進めたステップの分だけ数える
    const dt = k / 240;
    let dx = s.distance - this.lastX;
    this.lastX = s.distance;
    if (cfg.speedCap > 0) dx = Math.min(dx, cfg.speedCap * dt);
    let smooth = 0;
    for (let i = 0; i < 4; i++) smooth += Math.abs(u[i]! - this.prev[i]!);
    this.prev = u;
    let rew =
      cfg.wForward * dx +
      cfg.wTime * dt +
      cfg.wSmooth * smooth +
      cfg.wAir * (airSteps / Math.max(1, k));

    let ended: Ended | undefined;
    if (jumped || s.ended === "fell") {
      ended = jumped ? "jump" : "fell";
      rew += cfg.fallPenalty;
    } else if (s.ended === "goal") {
      ended = "goal";
      rew += cfg.goalBonus;
    } else if (s.time >= cfg.maxTime) {
      ended = "timeout";
    } else if (s.distance > this.progressX + 0.3) {
      this.progressX = s.distance;
      this.progressT = s.time;
    } else if (cfg.stuckTime > 0 && s.time - this.progressT > cfg.stuckTime) {
      ended = "stuck";
    }
    return { rew, ended };
  }

  info(ended: Ended): EpisodeInfo {
    const s = this.sim;
    const r = {
      ended: ended === "jump" ? ("fell" as const) : ended,
      time: s.time,
      distance: s.distance,
      peakSpeed: this.peakSpeed,
      maxTorsoY: this.maxTorsoY,
      airFrac: this.air / Math.max(1, this.steps),
    };
    return {
      ended,
      time: s.time,
      distance: Math.min(GOAL_M, s.distance),
      problems: sanity(this.params, r).length,
      airFrac: r.airFrac,
      peakSpeed: r.peakSpeed,
      final: this.obs(),
    };
  }
}

let envs: Env[] = [];

function handle(msg: { cmd: string; n?: number; config?: Partial<EnvConfig>; a?: number[][] }) {
  if (msg.cmd === "init") {
    const cfg = { ...DEFAULT_CONFIG, ...msg.config };
    if (!playableActionHz(cfg.actionHz))
      throw new Error(
        `actionHz ${cfg.actionHz} は使えない。行動を変える間隔（240 / actionHz を丸めたステップ数）が 4 の倍数になる値にする（60・30・20・15・12・10 など）`,
      );
    envs = Array.from({ length: msg.n ?? 1 }, () => new Env(cfg));
    return { obs: envs.map((e) => e.obs()), obsDim: obsDim(cfg.base) };
  }
  if (msg.cmd === "reset") {
    return { obs: envs.map((e) => e.reset()) };
  }
  if (msg.cmd === "step") {
    const obs: number[][] = [];
    const rew: number[] = [];
    const done: boolean[] = [];
    const info: (EpisodeInfo | null)[] = [];
    envs.forEach((e, i) => {
      const r = e.step(msg.a![i]!);
      rew.push(r.rew);
      done.push(r.ended !== undefined);
      if (r.ended) {
        info.push(e.info(r.ended));
        obs.push(e.reset());
      } else {
        info.push(null);
        obs.push(e.obs());
      }
    });
    return { obs, rew, done, info };
  }
  throw new Error(`知らない cmd: ${msg.cmd}`);
}

if (process.argv[1]?.replace(/\\/g, "/").endsWith("lab/rl/server.ts")) {
  const rl = createInterface({ input: process.stdin });
  rl.on("line", (line) => {
    if (!line.trim()) return;
    process.stdout.write(`${JSON.stringify(handle(JSON.parse(line)))}\n`);
  });
}

export { Env };

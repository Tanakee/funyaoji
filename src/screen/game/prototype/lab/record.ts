/// <reference types="node" />
// 試作（あとで捨てる）：1回の走りを、コマごとの体の位置として記録する。描画（render.ts）はこの記録だけを読む
import { writeFileSync, readFileSync } from "node:fs";
import type { Shape } from "../sim.ts";
import {
  run,
  footContact,
  sanity,
  JOINTS,
  NO_NOISE,
  type Controller,
  type Noise,
  type Params,
  type RunResult,
  type JointName,
} from "./run.ts";

export interface Recording {
  /** 動画に出す名前 */
  label: string;
  /** 動画に出す説明（1行） */
  note?: string;
  params: Params;
  /** 記録に使った入力（歩き方の値など）。人が読むため */
  controller?: unknown;
  fps: number;
  parts: { name: string; side: "center" | "right" | "left"; shapes: Shape[] }[];
  frames: {
    t: number;
    /** parts と同じ順の [x, y, 回転] */
    p: [number, number, number][];
    /** 糸 [吊る点 x, y, 引く点 x, y, 張っているか(1/0), 関節の番号] */
    s: [number, number, number, number, number, number][];
    /** 関節ごとの入力（0〜1） */
    in: number[];
    /** 関節ごとの、目標に対する実際の角度の割合（0〜1。入力と同じ目盛り） */
    ang: number[];
    /** 足が着いているか [右, 左] */
    c: [number, number];
  }[];
  result: RunResult & { problems: string[] };
}

export function record(
  label: string,
  params: Params,
  controller: Controller,
  opts: { noise?: Noise; note?: string; controllerInfo?: unknown } = {},
): Recording {
  const frames: Recording["frames"] = [];
  let parts: Recording["parts"] = [];
  const r = run(params, controller, opts.noise ?? NO_NOISE, (sim, input) => {
    if (!parts.length)
      parts = sim.parts.map((p) => ({ name: p.name, side: p.side, shapes: p.shapes }));
    const c = footContact(sim);
    frames.push({
      t: round(sim.time, 3),
      p: sim.parts.map((p) => {
        const t = p.body.translation();
        return [round(t.x, 4), round(t.y, 4), round(p.body.rotation(), 4)];
      }),
      s: sim.strings.map((s) => [
        round(s.from.x, 3),
        round(s.from.y, 3),
        round(s.to.x, 3),
        round(s.to.y, 3),
        s.taut ? 1 : 0,
        JOINTS.indexOf(s.joint),
      ]),
      in: JOINTS.map((j) => round(input[j], 3)),
      ang: JOINTS.map((j: JointName) => {
        const { lo, hi } = sim.range[j];
        return round((sim.jointAngle(j) - lo) / (hi - lo), 3);
      }),
      c: [c[0] ? 1 : 0, c[1] ? 1 : 0],
    });
  });
  return {
    label,
    note: opts.note,
    params,
    controller: opts.controllerInfo,
    fps: 60,
    parts,
    frames,
    result: { ...r, problems: sanity(params, r) },
  };
}

export function save(path: string, rec: Recording): void {
  writeFileSync(path, JSON.stringify(rec));
}

export function load(path: string): Recording {
  return JSON.parse(readFileSync(path, "utf8")) as Recording;
}

function round(x: number, d: number): number {
  const k = 10 ** d;
  return Math.round(x * k) / k;
}

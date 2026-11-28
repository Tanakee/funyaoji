// 入力の記録と、その再生（docs/ml.md の「再生をそろえる」）。DOM にも Node にも依存しない
import { JOINTS } from "../../../shared/messages.ts";
import { Sim, type SimOptions, type SimState } from "../sim.ts";
import { ACTION_HZ, quantize, toJointInputs } from "./observe.ts";

/** AI の走り。毎秒30回の、JOINTS の順の4つの入力（1/1000 にそろえた値） */
export interface InputRecord {
  hz: typeof ACTION_HZ;
  joints: typeof JOINTS;
  inputs: number[][];
}

/**
 * 記録を Sim で再生する。1/30 秒ごとに入力を1つ進め、物理を最大 8 ステップ進める。
 * 終わったらそこで止める。initPhysics() を待ってから呼ぶ。
 * onTick を渡すと、入力を1つ進めるたびに、そのあとの状態を渡す
 */
export function replay(
  record: InputRecord,
  options: SimOptions = {},
  onTick?: (state: SimState) => void,
): SimState {
  const sim = new Sim(options);
  try {
    sim.start();
    onTick?.(sim.state());
    for (const values of record.inputs) {
      sim.advance(toJointInputs(values.map(quantize)), 1 / record.hz);
      const state = sim.state();
      onTick?.(state);
      if (state.status === "ended") break;
    }
    return sim.state();
  } finally {
    sim.free();
  }
}

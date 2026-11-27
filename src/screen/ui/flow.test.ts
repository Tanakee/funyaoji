import { describe, expect, it } from "vite-plus/test";
import { JOINTS, type Joint } from "../../shared/messages.ts";
import { INITIAL_FLOW, reduce, type Flow, type FlowEvent } from "./flow.ts";

const all: readonly Joint[] = JOINTS;
const goal = { outcome: "goal", distanceM: 10, timeMs: 5000 } as const;

function run(events: FlowEvent[], from: Flow = INITIAL_FLOW): Flow {
  return events.reduce(reduce, from);
}

describe("reduce", () => {
  it("4台そろえば、スペースで開始できる", () => {
    expect(run([{ type: "start", joints: all, debug: false }])).toEqual({
      kind: "countdown",
      count: 3,
      players: all,
    });
  });

  it("4台そろっていないと、通常の開始はできない。デバッグの開始はできる", () => {
    const joints = ["rightHip"] as const;
    expect(run([{ type: "start", joints, debug: false }])).toEqual(INITIAL_FLOW);
    expect(run([{ type: "start", joints, debug: true }]).kind).toBe("countdown");
    expect(run([{ type: "start", joints: [], debug: true }]).kind).toBe("countdown");
  });

  it("3・2・1 のあとプレイになり、ゴールで結果になる", () => {
    const flow = run([
      { type: "start", joints: all, debug: false },
      { type: "tick" },
      { type: "tick" },
    ]);
    expect(flow).toEqual({ kind: "countdown", count: 1, players: all });
    expect(run([{ type: "tick" }, { type: "ended", result: goal }], flow)).toEqual({
      kind: "result",
      result: goal,
      players: all,
    });
  });

  it("プレイ中でなければ、ゲームの終了は無視する", () => {
    expect(run([{ type: "ended", result: goal }])).toEqual(INITIAL_FLOW);
  });

  it("結果からやり直すと、同じ players でカウントダウンになる", () => {
    const result: Flow = { kind: "result", result: goal, players: ["leftHip"] };
    expect(run([{ type: "restart" }], result)).toEqual({
      kind: "countdown",
      count: 3,
      players: ["leftHip"],
    });
  });

  it("プレイ中とカウントダウン中は、players の誰かが抜けても戻さない（つなぎ直しを待つ）", () => {
    const joints = all.filter((joint) => joint !== "leftKnee");
    const states: Flow[] = [
      { kind: "countdown", count: 2, players: all },
      { kind: "playing", players: all },
    ];
    for (const state of states) {
      expect(run([{ type: "room", joints }], state)).toBe(state);
    }
  });

  it("結果の画面で players の誰かが抜けたら、ロビーに戻る。増えるだけなら残る", () => {
    const flow: Flow = { kind: "result", result: goal, players: ["rightHip"] };
    expect(run([{ type: "room", joints: ["rightHip", "leftHip"] }], flow)).toBe(flow);
    expect(run([{ type: "room", joints: [] }], flow)).toEqual(INITIAL_FLOW);
  });

  it("プレイ中のやり直しは、同じ players でカウントダウンに戻る", () => {
    const players = ["leftHip"] as const;
    for (const state of [
      { kind: "playing", players },
      { kind: "countdown", count: 1, players },
    ] satisfies Flow[]) {
      expect(run([{ type: "restart" }], state)).toEqual({ kind: "countdown", count: 3, players });
    }
    expect(run([{ type: "restart" }])).toEqual(INITIAL_FLOW);
  });

  it("切断の結果でも、プレイ中なら結果の画面になる", () => {
    const result = { outcome: "disconnected", distanceM: 3.2 } as const;
    expect(run([{ type: "ended", result }], { kind: "playing", players: all })).toEqual({
      kind: "result",
      result,
      players: all,
    });
  });
});

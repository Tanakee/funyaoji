import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";
import { NEUTRAL_INPUTS } from "./body.ts";
import { createGame } from "./game.ts";
import type { SimOptions } from "./sim.ts";
import type { View } from "./view.ts";

// 作った Sim に渡したオプションを、作った順に残す
const created = vi.hoisted(() => [] as (SimOptions | undefined)[]);

vi.mock("./sim.ts", async (importOriginal) => {
  const original = await importOriginal<typeof import("./sim.ts")>();
  class RecordedSim extends original.Sim {
    constructor(options?: SimOptions) {
      super(options);
      created.push(options);
    }
  }
  return { ...original, Sim: RecordedSim };
});

// 描画（PixiJS）は使わない。フレームはテストが進める。
// 本物の View の形で作るので、View にメソッドが増えたら、ここが型エラーになる
let frame: ((dtSec: number) => void) | undefined;
vi.mock("./view.ts", () => {
  const createView: typeof import("./view.ts").createView = async () => {
    let speech: string | undefined;
    const view: View = {
      setScene() {},
      onFrame(callback) {
        frame = callback;
      },
      setSeats() {},
      setExpression() {},
      say(text) {
        speech = text;
      },
      get speech() {
        return speech;
      },
      render() {},
      destroy() {},
    };
    return view;
  };
  return { createView };
});

beforeEach(() => {
  created.length = 0;
  frame = undefined;
  // 開発のときだけ書く、自動の確認用の値の置き場。Rapier も window から時計などを読むので、空のものにはしない
  vi.stubGlobal("window", globalThis);
});
afterEach(() => {
  delete (globalThis as { __funyaojiGame?: unknown }).__funyaojiGame;
  vi.unstubAllGlobals();
});

test("ロビーの練習のあとにハードで始め、もう一度でも、ハードの物理で走る", async () => {
  const game = await createGame({
    container: {} as HTMLElement,
    inputs: { ...NEUTRAL_INPUTS },
    onEnd() {},
  });
  try {
    game.practice("hard");
    game.reset("hard");
    game.start();
    frame?.(1 / 60);
    // もう一度
    game.reset("hard");
    game.start();
    frame?.(1 / 60);
    // 最初の1つは createGame が作る、まだ使わない Sim
    expect(created.slice(1)).toEqual([
      { practice: true, hard: true },
      { hard: true },
      { hard: true },
    ]);
  } finally {
    game.destroy();
  }
});

test("ロビーの練習は、渡したモードの物理で吊る", async () => {
  const game = await createGame({
    container: {} as HTMLElement,
    inputs: { ...NEUTRAL_INPUTS },
    onEnd() {},
  });
  try {
    game.practice("normal");
    frame?.(1 / 60);
    game.practice("hard");
    frame?.(1 / 60);
    game.practice("normal");
    expect(created.slice(1).map((o) => [o?.practice, o?.hard ?? false])).toEqual([
      [true, false],
      [true, true],
      [true, false],
    ]);
  } finally {
    game.destroy();
  }
});

test("ノーマルで始めると、ハードの物理を使わない", async () => {
  const game = await createGame({
    container: {} as HTMLElement,
    inputs: { ...NEUTRAL_INPUTS },
    onEnd() {},
  });
  try {
    game.reset("hard");
    game.reset("normal");
    expect(created.at(-1)?.hard ?? false).toBe(false);
  } finally {
    game.destroy();
  }
});

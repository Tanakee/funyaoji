// ゲームの組み立て。物理（Sim）を固定の刻みで進め、描画（View）に渡し、終わりを 1 回だけ知らせる
import { Sim, initPhysics } from "./sim.ts";
import type { Game, GameOptions } from "./types.ts";
import { createView } from "./view.ts";

/** タブが裏に回ったあとなど、大きな間隔は物理に渡さない（1 フレームで進めすぎない） */
const MAX_FRAME_S = 0.1;

declare global {
  interface Window {
    /** 自動の確認用。開発のときだけ、毎フレーム更新する */
    __funyaojiGame?: { distanceM: number; elapsedMs: number; ended: boolean };
  }
}

export async function createGame({ container, inputs, onEnd }: GameOptions): Promise<Game> {
  await initPhysics();
  const view = await createView(container);
  let sim = new Sim();
  let reported = false;
  let destroyed = false;

  view.onFrame((dtSec) => {
    sim.advance(inputs, Math.min(dtSec, MAX_FRAME_S));
    const state = sim.state();
    view.render(state);
    if (import.meta.env.DEV) {
      window.__funyaojiGame = {
        distanceM: state.distanceM,
        elapsedMs: state.elapsedMs,
        ended: state.status === "ended",
      };
    }
    if (state.result && !reported) {
      reported = true;
      onEnd(state.result);
    }
  });

  return {
    reset() {
      sim.free();
      sim = new Sim();
      reported = false;
    },
    start() {
      sim.start();
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      view.destroy();
      sim.free();
    },
  };
}

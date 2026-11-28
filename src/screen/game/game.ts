// ゲームの組み立て。物理（Sim）を固定の刻みで進め、描画（View）に渡し、終わりを 1 回だけ知らせる
import type { Joint } from "../../shared/messages.ts";
import type { Expression } from "./art.ts";
import type { Pose } from "./body.ts";
import type { Scene } from "./camera.ts";
import { Sim, initPhysics } from "./sim.ts";
import type { Game, GameOptions } from "./types.ts";
import { UNCLE_ART } from "./uncle-art/uncle-art.ts";
import { createView } from "./view.ts";

/** タブが裏に回ったあとなど、大きな間隔は物理に渡さない（1 フレームで進めすぎない） */
const MAX_FRAME_S = 0.1;

declare global {
  interface Window {
    /** 自動の確認用。開発のときだけ、毎フレーム更新する */
    __funyaojiGame?: {
      distanceM: number;
      elapsedMs: number;
      ended: boolean;
      scene: Scene;
      /** ロビーの練習で吊っているか */
      practice: boolean;
      torso: Pose;
      /** 関節の角度（rad） */
      joints: Record<Joint, number>;
    };
  }
}

export async function createGame({ container, inputs, onEnd, art }: GameOptions): Promise<Game> {
  await initPhysics();
  const view = await createView(container, art ?? UNCLE_ART);
  let sim = new Sim();
  let practicing = false;
  let reported = false;
  let stopped = false;
  let destroyed = false;
  let expression: Expression = "normal";
  let scene: Scene = "lobby";

  function setScene(next: Scene): void {
    scene = next;
    view.setScene(scene);
    // 自動の確認が、次のフレームを待たずに読めるように
    if (import.meta.env.DEV && window.__funyaojiGame) window.__funyaojiGame.scene = scene;
  }

  view.onFrame((dtSec) => {
    if (!stopped) sim.advance(inputs, Math.min(dtSec, MAX_FRAME_S));
    const state = sim.state();
    const nextExpression = state.result?.outcome === "fell" ? "fell" : "normal";
    if (expression !== nextExpression) {
      expression = nextExpression;
      view.setExpression(expression);
    }
    view.render(state, inputs, dtSec);
    if (import.meta.env.DEV) {
      window.__funyaojiGame = {
        distanceM: state.distanceM,
        elapsedMs: state.elapsedMs,
        ended: state.status === "ended",
        scene,
        practice: practicing,
        torso: state.poses.torso,
        joints: Object.fromEntries(
          Object.entries(sim.readout().joints).map(([joint, { angle }]) => [joint, angle]),
        ) as Record<Joint, number>,
      };
    }
    if (state.result && !reported) {
      reported = true;
      setScene("result");
      onEnd(state.result);
    }
  });

  return {
    setSeats(seats) {
      view.setSeats(seats);
    },
    reset() {
      sim.free();
      sim = new Sim();
      practicing = false;
      reported = false;
      stopped = false;
      setScene("countdown");
    },
    start() {
      sim.start();
      setScene("playing");
    },
    practice() {
      sim.free();
      sim = new Sim({ practice: true });
      practicing = true;
      reported = false;
      stopped = false;
      setScene("lobby");
    },
    stop(options) {
      // 描画は続けるので、止めた場所の絵が残る。終わりの知らせも出さない
      stopped = true;
      reported = true;
      // ルームを閉じたときにも止めるので、結果の画面にするのは頼まれたときだけ
      if (options?.showResult) setScene("result");
      return sim.state().distanceM;
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      view.destroy();
      sim.free();
    },
  };
}

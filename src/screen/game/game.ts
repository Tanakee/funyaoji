// ゲームの組み立て。物理（Sim）を固定の刻みで進め、描画（View）に渡し、終わりを 1 回だけ知らせる
import type { Joint, Mode } from "../../shared/messages.ts";
import type { Expression } from "./art.ts";
import type { Pose } from "./body.ts";
import type { Scene } from "./camera.ts";
import { UncleExpression } from "./expression.ts";
import { modeSimOptions } from "./modes.ts";
import { Sim, initPhysics } from "./sim.ts";
import { SPEECH, SpeechPicker, speechTrigger } from "./speech.ts";
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
      speech?: string;
      scene: Scene;
      /** ロビーの練習で吊っているか */
      practice: boolean;
      /** いまの走りか練習のモード */
      mode: Mode;
      torso: Pose;
      /** 関節の角度（rad） */
      joints: Record<Joint, number>;
    };
  }
}

export async function createGame({
  container,
  inputs,
  onEnd,
  art,
  bubbleStyle,
}: GameOptions): Promise<Game> {
  await initPhysics();
  const view = await createView(container, art ?? UNCLE_ART, { bubbleStyle });
  const picker = new SpeechPicker();
  let spoken = false;
  let sim = new Sim();
  let practicing = false;
  // いまの走りか練習のモード。reset と practice で物理演算（Sim）に渡す
  let mode: Mode = "normal";
  let reported = false;
  let stopped = false;
  let destroyed = false;
  let expression: Expression = "normal";
  let uncleExpression = new UncleExpression();
  let scene: Scene = "lobby";

  function setScene(next: Scene): void {
    scene = next;
    view.setScene(scene);
    // 自動の確認が、次のフレームを待たずに読めるように
    if (import.meta.env.DEV && window.__funyaojiGame) window.__funyaojiGame.scene = scene;
  }

  function setExpression(next: Expression): void {
    if (expression === next) return;
    expression = next;
    view.setExpression(expression);
  }

  function resetExpression(): void {
    uncleExpression = new UncleExpression();
    setExpression("normal");
  }

  view.onFrame((dtSec) => {
    if (!stopped) sim.advance(inputs, Math.min(dtSec, MAX_FRAME_S));
    const state = sim.state();
    if (!stopped) {
      setExpression(uncleExpression.update(inputs, performance.now(), state.result?.outcome));
    }
    if (state.result && !spoken) {
      spoken = true;
      const trigger = speechTrigger(state.result, sim.readout().sittingMs);
      if (SPEECH.showOn[trigger]) view.say(picker.next(trigger));
    }
    view.render(state, inputs, dtSec);
    if (import.meta.env.DEV) {
      window.__funyaojiGame = {
        distanceM: state.distanceM,
        elapsedMs: state.elapsedMs,
        ended: state.status === "ended",
        get speech() {
          return view.speech;
        },
        scene,
        practice: practicing,
        mode,
        torso: state.poses.torso,
        joints: Object.fromEntries(
          Object.entries(sim.readout().joints).map(([joint, { angle }]) => [joint, angle]),
        ) as Record<Joint, number>,
      };
    }
    if (state.result && !reported) {
      reported = true;
      // ゴールは FINISH の間、プレイ中の表示を残す。呼び出し側が stop({ showResult }) で結果にする
      if (state.result.outcome !== "goal") setScene("result");
      onEnd(state.result);
    }
  });

  return {
    setSeats(seats) {
      view.setSeats(seats);
    },
    reset(nextMode) {
      mode = nextMode;
      sim.free();
      sim = new Sim(modeSimOptions(mode));
      practicing = false;
      reported = false;
      stopped = false;
      resetExpression();
      spoken = false;
      view.say(undefined);
      setScene("countdown");
    },
    start() {
      sim.start();
      setScene("playing");
    },
    practice(nextMode) {
      mode = nextMode;
      sim.free();
      sim = new Sim({ ...modeSimOptions(mode), practice: true });
      practicing = true;
      reported = false;
      stopped = false;
      resetExpression();
      spoken = false;
      view.say(undefined);
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

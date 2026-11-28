// モードごとの設定の一覧（docs/ml.md の「モードの一覧」）。DOM にも Node にも依存しない。
// 強化学習の道具（学習・物理の指紋・理論値の記録・再生の一致のテスト・CI の学習し直し）は、この一覧を回る。
// モードを1つ足すと、CI がそのモードの理論値の記録を作り、差し替える PR を出す
import type { Mode } from "../../shared/messages.ts";
import type { SimOptions } from "./sim.ts";

/** モードで変わる、Sim の設定。物理の刻みと練習は、モードではなく使う側が決めるので除く */
export type ModeSimOptions = Omit<SimOptions, "stepS" | "practice">;

/**
 * 1つのモードの設定。今は物理（sim）だけ。
 * 障害物モードなどで、観測の形・学習の設定・土台の歩き方がモードで変わるときは、ここに足す
 */
export interface ModeSettings {
  /** Sim に渡す設定 */
  sim: ModeSimOptions;
}

/**
 * モードごとの設定。キーはゲームのモード（src/shared/messages.ts の MODES）と同じ値。
 * まだ物理の無いモードは載せない
 */
export const MODE_SETTINGS = {
  normal: { sim: {} },
  hard: { sim: { hard: true } },
} as const satisfies Partial<Record<Mode, ModeSettings>>;

/** 一覧に載っているモード */
export type SimMode = keyof typeof MODE_SETTINGS;

/** 一覧に載っているモード。並びは一覧の順 */
export const SIM_MODES = Object.keys(MODE_SETTINGS) as SimMode[];

/** 省いたときのモード */
export const DEFAULT_SIM_MODE: SimMode = "normal";

/** 名前（コマンドの引数など）を、一覧のモードに直す。一覧に無ければ止める */
export function toSimMode(name: string): SimMode {
  if ((SIM_MODES as string[]).includes(name)) return name as SimMode;
  throw new Error(
    `モードの一覧（src/screen/game/modes.ts）に無いモード：${name}（あるのは ${SIM_MODES.join("・")}）`,
  );
}

/** モードの Sim の設定。new Sim({ ...modeSimOptions(mode), stepS }) のように使う */
export function modeSimOptions(mode: SimMode): ModeSimOptions {
  const settings: ModeSettings = MODE_SETTINGS[mode];
  return settings.sim;
}

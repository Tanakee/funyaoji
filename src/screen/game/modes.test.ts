import { expect, test } from "vite-plus/test";
import { MODES } from "../../shared/messages.ts";
import {
  DEFAULT_SIM_MODE,
  SIM_MODES,
  modeSimOptions,
  toSimMode,
  type ModeSettings,
} from "./modes.ts";

test("一覧のモードは、ゲームのモードと同じ名前で、ファイルやブランチの名前に使える", () => {
  expect(SIM_MODES).toContain(DEFAULT_SIM_MODE);
  for (const mode of SIM_MODES) {
    expect(MODES).toContain(mode);
    // 理論値の記録のファイル名（theory/<モード>.json）や、CI の成果物の名前に入る
    expect(mode).toMatch(/^[a-z][a-z0-9-]*$/);
  }
});

test("ノーマルの Sim の設定は、何も変えない", () => {
  expect(modeSimOptions("normal")).toEqual({});
});

test("一覧に無いモードの名前は、止める", () => {
  expect(toSimMode("normal")).toBe("normal");
  expect(() => toSimMode("nope")).toThrow();
});

test("モードの設定は、ハードの物理（SimOptions.hard）を載せられる", () => {
  // 一覧にはまだ足さない。型が受け付けることだけを確かめる
  const hard: ModeSettings = { sim: { hard: true } };
  expect(hard.sim).toEqual({ hard: true });
});

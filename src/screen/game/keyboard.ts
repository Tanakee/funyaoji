// キーボード操作（確かめる用）。押している間、関節の入力を少しずつ上げ下げする
import { JOINTS, type Joint } from "../../shared/messages.ts";
import type { JointInputs } from "./types.ts";

/**
 * 関節ごとの、入力を上げるキーと下げるキー（KeyboardEvent.code）。物理的な位置で決める（日本語入力中でも効く）。
 * label は画面に出す文字
 */
export const KEYBOARD_KEYS: Record<
  Joint,
  { up: { code: string; label: string }; down: { code: string; label: string } }
> = {
  rightHip: { up: { code: "KeyQ", label: "Q" }, down: { code: "KeyA", label: "A" } },
  leftHip: { up: { code: "KeyW", label: "W" }, down: { code: "KeyS", label: "S" } },
  rightKnee: { up: { code: "KeyO", label: "O" }, down: { code: "KeyL", label: "L" } },
  leftKnee: { up: { code: "KeyP", label: "P" }, down: { code: "Semicolon", label: ";" } },
};

/** 押し続けたとき、1 秒に動く入力の量。0 から 1 まで 1/3 秒 */
export const KEY_RATE_PER_S = 3;
/** タブを切り替えたあとなどの大きな間隔で、入力が飛ばないようにする */
const MAX_FRAME_S = 0.1;

/** 押されているキーに合わせて、inputs を dtSec 秒ぶん動かす */
export function moveInputs(inputs: JointInputs, held: ReadonlySet<string>, dtSec: number): void {
  for (const joint of JOINTS) {
    const { up, down } = KEYBOARD_KEYS[joint];
    const direction = Number(held.has(up.code)) - Number(held.has(down.code));
    if (direction === 0) continue;
    inputs[joint] = Math.min(1, Math.max(0, inputs[joint] + direction * KEY_RATE_PER_S * dtSec));
  }
}

const isEditable = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));

/** target のキー入力を inputs に書き込み始める。戻り値を呼ぶと止める */
export function attachKeyboard(inputs: JointInputs, target: Window = window): () => void {
  const held = new Set<string>();
  let last = performance.now();
  let frame = requestAnimationFrame(function tick(now) {
    moveInputs(inputs, held, Math.min(MAX_FRAME_S, (now - last) / 1000));
    last = now;
    frame = requestAnimationFrame(tick);
  });

  const onKeyDown = (e: KeyboardEvent) => {
    // 入力欄への打ち込み（チーム名など）や、Ctrl+L のようなショートカットには反応しない
    if (isEditable(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
    held.add(e.code);
  };
  const onKeyUp = (e: KeyboardEvent) => held.delete(e.code);
  // 別のウィンドウに移ると keyup が届かず、押しっぱなしになる
  const onBlur = () => held.clear();
  target.addEventListener("keydown", onKeyDown);
  target.addEventListener("keyup", onKeyUp);
  target.addEventListener("blur", onBlur);

  return () => {
    cancelAnimationFrame(frame);
    target.removeEventListener("keydown", onKeyDown);
    target.removeEventListener("keyup", onKeyUp);
    target.removeEventListener("blur", onBlur);
    held.clear();
  };
}

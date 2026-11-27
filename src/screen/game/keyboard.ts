// キーボード操作（確かめる用・スマホのいない関節用）。関節ごとに1つのキー。
// 押している間は糸を引くように入力が PRESSED へ、離すと RELEASED へ、少しずつ動く
import { JOINTS, type Joint } from "../../shared/messages.ts";
import type { JointInputs } from "./types.ts";

/**
 * 関節ごとのキー（KeyboardEvent.code）。物理的な位置で決める（日本語入力中でも効く）。
 * label は画面に出す文字
 */
export const KEYBOARD_KEYS: Record<Joint, { code: string; label: string }> = {
  rightHip: { code: "KeyQ", label: "Q" },
  leftHip: { code: "KeyW", label: "W" },
  rightKnee: { code: "KeyO", label: "O" },
  leftKnee: { code: "KeyP", label: "P" },
};

// 値は、4人がばらばらに押すのをまねて物理を走らせ、比べて決めた（docs/game.md の「関節の入力」）。
// 歩こうとして押したときに転ばないことを守ったうえで、前に進む速さを取る

/**
 * 押しているときの入力。1（いっぱい）まで振ると、でたらめに押すとほぼ必ず転ぶので、手前で止める。
 * もも 0.8・ひざ 0.5 より大きくすると、歩くのは速くなるが、転ぶのが急に増える
 */
export const PRESSED_INPUT = { hip: 0.8, knee: 0.5 } as const;
/**
 * 離したときに戻る入力。ひざは伸ばす。ももは立った姿勢（0.3）より後ろにし、
 * 押して前に振った脚で地面を後ろに蹴れるようにする。後ろに引くほどよく進む。0.15 では遅く、0.3 だとほとんど進まない
 */
export const RELEASED_INPUT = { hip: 0.05, knee: 0 } as const;
/** 1 秒に動く入力の量。押すときも離すときも同じ。0.05 から 0.8 まで約 0.13 秒。遅いと、脚を振り切る前に次のキーになり、進まない */
export const KEY_RATE_PER_S = 6;
/** タブを切り替えたあとなどの大きな間隔で、入力が飛ばないようにする */
const MAX_FRAME_S = 0.1;

const kind = (joint: Joint) => (joint.endsWith("Hip") ? "hip" : "knee");

/**
 * 押されているキーに合わせて、inputs を dtSec 秒ぶん動かす。
 * キーボードが動かすのは、キーを押した関節だけ。離したあとは RELEASED_INPUT に着くまで動かし、着いたら手を放す。
 * 押していない関節は触らないので、画面のつまみやお手本の値を上書きしない。driving は、いま動かしている関節（呼ぶたびに書き換える）。
 * controls が false の関節（スマホがいる・つまみでつかんでいるなど）は動かさない
 */
export function moveInputs(
  inputs: JointInputs,
  held: ReadonlySet<string>,
  dtSec: number,
  driving: Set<Joint>,
  controls: (joint: Joint) => boolean = () => true,
): void {
  for (const joint of JOINTS) {
    if (!controls(joint)) {
      driving.delete(joint);
      continue;
    }
    const pressed = held.has(KEYBOARD_KEYS[joint].code);
    if (pressed) driving.add(joint);
    if (!driving.has(joint)) continue;
    const target = (pressed ? PRESSED_INPUT : RELEASED_INPUT)[kind(joint)];
    const step = KEY_RATE_PER_S * dtSec;
    const now = inputs[joint];
    inputs[joint] = Math.abs(target - now) <= step ? target : now + Math.sign(target - now) * step;
    if (!pressed && inputs[joint] === target) driving.delete(joint);
  }
}

const isEditable = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));

/**
 * target のキー入力を inputs に書き込み始める。戻り値を呼ぶと止める。
 * controls は毎フレーム、関節ごとに、キーボードで動かしてよいかを答える
 */
export function attachKeyboard(
  inputs: JointInputs,
  controls: (joint: Joint) => boolean = () => true,
  target: Window = window,
): () => void {
  const held = new Set<string>();
  const driving = new Set<Joint>();
  let last = performance.now();
  let frame = requestAnimationFrame(function tick(now) {
    moveInputs(inputs, held, Math.min(MAX_FRAME_S, (now - last) / 1000), driving, controls);
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
    driving.clear();
  };
}

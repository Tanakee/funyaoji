import { JOINTS, type Joint } from "../../shared/messages.ts";
import { KEYBOARD_KEYS } from "../game/index.ts";
import { JOINT_LABELS } from "./labels.ts";
import type { ScreenView } from "./session.ts";

type JointStatus = "active" | "idle" | "keyboard";

/**
 * 4つの関節の入力の状態。直近0.5秒に tilt が届いている（active）・スマホはいるが届いていない（idle）・
 * スマホがいなくてキーボード（keyboard）。active の集合が変わったときだけ描き直す
 */
export function Hud({ view }: { view: ScreenView }) {
  if (view.flow.kind === "lobby") return null;
  const { players } = view.flow;
  const status = (joint: Joint): JointStatus =>
    !players.includes(joint) ? "keyboard" : view.active.includes(joint) ? "active" : "idle";
  return (
    <ul className="hud" aria-label="入力の状態">
      {JOINTS.map((joint) => (
        <li key={joint} className={`hud-joint hud-joint--${status(joint)}`}>
          <span className="hud-joint-name">{JOINT_LABELS[joint]}</span>
          {status(joint) === "keyboard" ? (
            <KeyHint joint={joint} />
          ) : (
            <span className="hud-joint-state">{STATUS_TEXT[status(joint)]}</span>
          )}
        </li>
      ))}
    </ul>
  );
}

/** キーボードで動かす関節に、どのキーで何が起きるかを出す。覚えていなくても操作できるように */
function KeyHint({ joint }: { joint: Joint }) {
  const { up, down } = KEYBOARD_KEYS[joint];
  const [upText, downText] = joint.endsWith("Hip") ? ["前", "後ろ"] : ["曲げる", "伸ばす"];
  return (
    <span className="hud-joint-keys">
      <kbd>{up.label}</kbd> {upText} <kbd>{down.label}</kbd> {downText}
    </span>
  );
}

const STATUS_TEXT: Record<JointStatus, string> = {
  active: "入力中",
  idle: "入力なし",
  keyboard: "キーボード",
};

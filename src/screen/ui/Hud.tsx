import { JOINTS, type Joint } from "../../shared/messages.ts";
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
          <span className="hud-joint-state">{STATUS_TEXT[status(joint)]}</span>
        </li>
      ))}
    </ul>
  );
}

const STATUS_TEXT: Record<JointStatus, string> = {
  active: "入力中",
  idle: "入力なし",
  keyboard: "キーボード",
};

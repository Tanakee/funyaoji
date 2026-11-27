import { JOINTS, type Joint } from "../../shared/messages.ts";
import { KEYBOARD_KEYS } from "../game/index.ts";
import { JOINT_LABELS } from "./labels.ts";
import type { ScreenView } from "./session.ts";

type JointStatus = "active" | "idle" | "keyboard" | "absent";

/**
 * 4つの関節の入力の状態。直近0.5秒に tilt が届いている（active）・スマホはいるが届いていない（idle）・
 * スマホがいなくてキーボード（keyboard）・切れてつなぎ直しを待っている（absent）。
 * active の集合が変わったときと、待つ残り秒数が変わった（1秒に1回）ときだけ描き直す
 */
export function Hud({ view }: { view: ScreenView }) {
  // ?debug のときは、ゲームの下のつまみが、関節ごとの担当（スマホ・キー）を見せる
  if (view.flow.kind === "lobby" || view.debug.enabled) return null;
  const { players } = view.flow;
  const status = (joint: Joint): JointStatus =>
    view.absent[joint] !== undefined
      ? "absent"
      : !players.includes(joint)
        ? "keyboard"
        : view.active.includes(joint)
          ? "active"
          : "idle";
  return (
    <ul className="hud" aria-label="入力の状態">
      {JOINTS.map((joint) => (
        <li key={joint} className={`hud-joint hud-joint--${status(joint)}`}>
          <span className="hud-joint-name">{JOINT_LABELS[joint]}</span>
          {status(joint) === "keyboard" ? (
            <KeyHint joint={joint} />
          ) : (
            <span className="hud-joint-state">
              {STATUS_TEXT[status(joint)]}
              {status(joint) === "absent" && `（あと${view.absent[joint]}秒）`}
            </span>
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
  absent: "切断中",
};

/** プレイ中・カウントダウン中の、やり直しのキー。動けなくなったときのために、いつでも出しておく */
export function RestartHint({ view }: { view: ScreenView }) {
  if (view.flow.kind !== "countdown" && view.flow.kind !== "playing") return null;
  return (
    <p className="restart-hint">
      動けなくなったら <kbd>Space</kbd> か <kbd>R</kbd> でやり直す
    </p>
  );
}

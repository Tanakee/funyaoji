import type { CSSProperties } from "react";
import type { Joint } from "../shared/messages.ts";
import { Gauge } from "./Gauge.tsx";
import { JOINT_LABELS } from "./joints.ts";
import { LobbyLeg, TILT_ICON } from "./Lobby.tsx";

export function HowTo({
  room,
  joint,
  ready,
  onReady,
}: {
  room: string | undefined;
  joint: Joint;
  ready: boolean;
  onReady: () => void;
}) {
  const label = JOINT_LABELS[joint];
  return (
    <section
      className="lobby howto phone-content"
      style={{ "--joint": label.color, "--joint-fg": label.textOnColor } as CSSProperties}
    >
      <p className="room lobby-room">
        ルームコード <b>{room}</b>
      </p>
      <p className="lobby-caption">あなたの担当</p>
      <div className="joint-card">
        <LobbyLeg thigh={label.hip} />
        <h1>{label.name}</h1>
      </div>
      <div className="lobby-controls">
        <p className="joint-hint">
          {TILT_ICON}
          <span>{label.tiltHint}</span>
        </p>
        <Gauge />
      </div>
      <p className="howto-prompt">傾けてみよう</p>
      <div className="howto-action">
        {ready ? (
          <p role="status">みんなを待っています</p>
        ) : (
          <button type="button" className="phone-button" onClick={onReady}>
            準備OK
          </button>
        )}
      </div>
    </section>
  );
}

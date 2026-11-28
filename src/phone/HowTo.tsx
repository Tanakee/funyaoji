import type { CSSProperties } from "react";
import type { InputMethod, Joint } from "../shared/messages.ts";
import { CameraPreview } from "./camera/CameraPreview.tsx";
import { Gauge } from "./Gauge.tsx";
import { JOINT_LABELS } from "./joints.ts";
import { LobbyLeg, TILT_ICON } from "./Lobby.tsx";

export function HowTo({
  room,
  joint,
  ready,
  input,
  onReady,
}: {
  room: string | undefined;
  joint: Joint;
  ready: boolean;
  input: InputMethod;
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
        {input === "camera" ? (
          <>
            <CameraPreview />
            <p className="joint-hint">
              <span>{label.cameraHint}</span>
            </p>
          </>
        ) : (
          <p className="joint-hint">
            {TILT_ICON}
            <span>{label.tiltHint}</span>
          </p>
        )}
        <Gauge input={input} />
      </div>
      <p className="howto-prompt">{input === "camera" ? "指を曲げてみよう" : "傾けてみよう"}</p>
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

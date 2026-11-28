import type { CSSProperties } from "react";
import { JOINTS, type Joint } from "../shared/messages.ts";
import { Gauge } from "./Gauge.tsx";
import { JOINT_LABELS } from "./joints.ts";

const TILT_ICON = (
  <svg className="tilt-icon" viewBox="0 0 64 44" aria-hidden="true">
    <path d="M2 40 H26 L32 31 H8 Z" />
    <rect x="45" y="3" width="17" height="38" rx="4" />
    <path d="M19 26 Q27 8 40 11 M34 6 L40 11 L33 14 M50 8.5 H57" fill="none" />
  </svg>
);

function LobbyLeg({ thigh }: { thigh: boolean }) {
  const upper = "M99 39 L154 94";
  const lower = "M154 94 L161 151 H184";
  const own = thigh ? upper : lower;
  const other = thigh ? lower : upper;
  const x = thigh ? 163 : 161;
  const y = thigh ? 86 : 150;
  const string = `M${x + 8} 0 L${x} ${y}`;
  return (
    <svg
      className="lobby-leg"
      viewBox="0 0 250 166"
      preserveAspectRatio="xMidYMin meet"
      aria-hidden="true"
    >
      <path className="lobby-leg-faint" d={other} strokeWidth="16" />
      <path className="lobby-leg-outline" d={own} strokeWidth="22" />
      <path className="lobby-leg-white" d={own} strokeWidth="19" />
      <path className="lobby-leg-outline" d={string} strokeWidth="5" />
      <path className="lobby-leg-white" d={string} strokeWidth="3" />
      <circle className="lobby-knot" cx={x} cy={y} r="9" />
    </svg>
  );
}

export function Lobby({
  room,
  joint,
  count,
  onStart,
}: {
  room: string | undefined;
  joint: Joint;
  count: number;
  onStart: () => void;
}) {
  const label = JOINT_LABELS[joint];
  const remaining = JOINTS.length - count;
  return (
    <section
      className="lobby phone-content"
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
      <p className="lobby-players">
        <strong>
          {count} / {JOINTS.length}人
        </strong>
        {remaining > 0 ? <span>あと{remaining}人</span> : null}
      </p>
      {count === JOINTS.length ? (
        <button type="button" className="phone-button start-button" onClick={onStart}>
          スタート
        </button>
      ) : null}
    </section>
  );
}

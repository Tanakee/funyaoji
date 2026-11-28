import type { CSSProperties } from "react";
import type { Joint } from "../shared/messages.ts";
import { JOINT_LABELS } from "./joints.ts";

export function JointBand({ joint }: { joint: Joint }) {
  const label = JOINT_LABELS[joint];
  return (
    <p
      className="joint-band"
      style={{ "--joint": label.color, "--joint-fg": label.textOnColor } as CSSProperties}
    >
      {label.name}
    </p>
  );
}

import { useEffect, useState, type CSSProperties } from "react";
import type { Joint } from "../shared/messages.ts";
import { JOINT_LABELS } from "./joints.ts";
import { reconnectRemainingSeconds } from "./model.ts";
import { Waiting } from "./templates.tsx";

/**
 * 部位の帯の色（docs/screens.md の「4人の色と並び」）。
 * 文字の色は、背景との明るさの差で選ぶ。水色と黄に白い文字は読めない
 */
const BAND_COLORS: Record<Joint, { background: string; color: string }> = {
  leftKnee: { background: "#56b4e9", color: "#2b2b28" },
  leftHip: { background: "#1f4e9e", color: "#ffffff" },
  rightKnee: { background: "#f2b705", color: "#2b2b28" },
  rightHip: { background: "#c23a1a", color: "#ffffff" },
};

/** 残り秒数。1秒の切れ目を逃さないよう、1秒より短い間隔で見直す。値が同じなら React は描き直さない */
function useRemainingSeconds(since: number): number {
  const [remaining, setRemaining] = useState(() => reconnectRemainingSeconds(since, Date.now()));
  useEffect(() => {
    const tick = () => setRemaining(reconnectRemainingSeconds(since, Date.now()));
    tick();
    const timer = setInterval(tick, 200);
    return () => clearInterval(timer);
  }, [since]);
  return remaining;
}

/** P5a つなぎ直し中。待機・プレイ中・結果の画面の上に重ねる。上の端に自分の部位の帯を出し続ける */
export function Reconnecting({ joint, since }: { joint: Joint; since: number }) {
  const remaining = useRemainingSeconds(since);
  const band = BAND_COLORS[joint];
  return (
    <div className="overlay">
      <p
        className="joint-band"
        style={{ "--band-bg": band.background, "--band-fg": band.color } as CSSProperties}
      >
        {JOINT_LABELS[joint].name}
      </p>
      <Waiting title="つなぎ直しています" figure="handle">
        <p className="remaining">
          あと<span className="remaining-number">{remaining}</span>秒
        </p>
      </Waiting>
    </div>
  );
}

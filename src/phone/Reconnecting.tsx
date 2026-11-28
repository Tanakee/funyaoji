import { useEffect, useState } from "react";
import type { Joint } from "../shared/messages.ts";
import { JointBand } from "./JointBand.tsx";
import { reconnectRemainingSeconds } from "./model.ts";
import { Waiting } from "./templates.tsx";

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
  return (
    <div className="overlay">
      <JointBand joint={joint} />
      <Waiting title="つなぎ直しています" figure="handle">
        <p className="remaining">
          あと<span className="remaining-number">{remaining}</span>秒
        </p>
      </Waiting>
    </div>
  );
}

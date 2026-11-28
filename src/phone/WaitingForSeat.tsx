import { Waiting } from "./templates.tsx";

/** 断られた理由ごとの見出し。プレイ中は、4人そろわずに始めたときもあるので人数を言わない */
const TITLES = {
  full: "いま4人が遊んでいます",
  playing: "いまプレイ中です",
} as const;

/** P2a 順番待ち。満員かプレイ中に来たとき。席が空けば、つなぎ直しで自動で入る */
export function WaitingForSeat({
  reason,
  onCancel,
}: {
  reason: keyof typeof TITLES;
  onCancel: () => void;
}) {
  return (
    <div className="phone-content seat-waiting">
      <Waiting title={TITLES[reason]}>
        <p className="seat-waiting-hint">席が空くまで待とう</p>
      </Waiting>
      <button type="button" className="big-button" onClick={onCancel}>
        やめる
      </button>
    </div>
  );
}

import { Waiting } from "./templates.tsx";

/** P2a 順番待ち。満員かプレイ中に来たとき。席が空けば、つなぎ直しで自動で入る */
export function WaitingForSeat({ onCancel }: { onCancel: () => void }) {
  return (
    <div className="phone-content seat-waiting">
      <Waiting title="いま4人が遊んでいます">
        <p className="seat-waiting-hint">席が空くまで待とう</p>
      </Waiting>
      <button type="button" className="big-button" onClick={onCancel}>
        やめる
      </button>
    </div>
  );
}

export const COUNTDOWN_KINDS = ["count", "readyGo"] as const;
export type CountdownKind = (typeof COUNTDOWN_KINDS)[number];

export const GO_DISPLAY_MS = 800;
/**
 * 遅延を引くときの上限。スマホは片道の遅延をこの値までしか引かない。
 * スクリーンが最初の表示を待つ時間（countdownLeadMs）も、この値まで
 */
export const MAX_DELAY_MS = 1_000;
export const COUNTDOWN_GUIDANCE = "スマホを寝かせて持ってね";

interface CountdownStep {
  label: string;
  /** 次の表示に切り替えるまでの経過時間。最後の表示は開始の合図まで続く */
  untilMs?: number;
}

export const COUNTDOWNS: Record<
  CountdownKind,
  { durationMs: number; startLabel: string; steps: readonly [CountdownStep, ...CountdownStep[]] }
> = {
  count: {
    durationMs: 3_000,
    startLabel: "GO!",
    steps: [{ label: "3", untilMs: 1_000 }, { label: "2", untilMs: 2_000 }, { label: "1" }],
  },
  readyGo: {
    durationMs: 1_500,
    startLabel: "ドン！",
    steps: [{ label: "よーい" }],
  },
};

/** 最初の表示の前。遅いスマホに phase が届くのを待つあいだは、数字を出さない */
const LEAD_STEP: CountdownStep = { label: "", untilMs: 0 };

/**
 * 開始の合図までは、スクリーンもスマホも同じ経過時間で表示を選ぶ。
 * 経過時間が負（最初の表示の前）なら、label が空の表示を返す
 */
export function countdownStep(kind: CountdownKind, elapsedMs: number): CountdownStep {
  if (elapsedMs < 0) return LEAD_STEP;
  const { steps } = COUNTDOWNS[kind];
  return steps.find(({ untilMs }) => untilMs === undefined || elapsedMs < untilMs) ?? steps[0];
}

/**
 * スクリーンが、最初の表示（「3」「よーい」）を出すまで待つ時間。いちばん遅いスマホの片道の遅延（MAX_DELAY_MS まで）。
 * 待たないと、遅いスマホは phase が届くまで最初の表示を出せず、そのぶん遅れる
 */
export function countdownLeadMs(delayMs: Readonly<Partial<Record<string, number>>>): number {
  const delays = Object.values(delayMs).filter((delay) => delay !== undefined);
  return Math.min(MAX_DELAY_MS, Math.max(0, ...delays));
}

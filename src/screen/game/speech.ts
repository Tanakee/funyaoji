import { SIT_MS } from "./sim.ts";
import type { GameResult } from "./types.ts";

export const SPEECH = {
  // 各表の最初の台詞は、その終わり方で初めて表示するときに使う
  lines: {
    fell: [
      "アキレス腱がー！",
      "あいたたた…",
      "膝がー！",
      "明日は筋肉痛だな…",
      "準備運動、しとけば…",
      "母さん、湿布！",
      "昔はもっと走れたんだ",
      "今のはナシ！",
    ],
    sat: [
      "膝がー！",
      "もう立てん…",
      "膝が笑ってる…",
      "ちょっと一服…",
      "腰が抜けた…",
      "あとは若いのに任せた",
      "息が、上がった…",
      "足が棒だ…",
    ],
    goal: ["まだまだ若いもんには\n負けん！", "やったー！膝が笑ってる"],
  },
  showOn: { fell: true, sat: true, goal: false },
  // null なら結果画面でも次の走りまで残す
  durationMs: null as number | null,
  // 通常はおじさんが向いている右側に置く
  side: "right" as "right" | "left",
  // 1280×720 での文字サイズ（px）
  fontSize: 36,
  // スクリーンで読める1行の字数
  maxCharsPerLine: 20,
  maxLines: 2,
  popMs: 160,
  defaultStyle: "a",
  // 頭の上端・横端から吹き出しの辺までの余白（頭の半径に対する比）
  headGapRatio: 0.2,
  popStartScale: 0.7,
  // 複数行でも字が窮屈にならない行間
  lineHeightRatio: 1.25,
  strokeWidth: 3,
  padding: { x: 16, y: 12 },
  tag: { radius: 10, tailHalfWidth: 9 },
  shadow: { offset: 5, alpha: 0.25 },
  ellipseTailHalfAngle: 0.19,
  // 叫びの輪郭の頂点数と、谷の半径の比
  burst: { points: 20, innerRatio: 0.84 },
} as const;

export type SpeechTrigger = "fell" | "sat" | "goal";
// a は札、b は楕円、c は叫び（?debug&bubble= で切り替える）
export type BubbleStyle = "a" | "b" | "c";

export function speechTrigger(result: GameResult, sittingMs: number): SpeechTrigger {
  if (result.outcome === "goal") return "goal";
  return sittingMs >= SIT_MS ? "sat" : "fell";
}

export class SpeechPicker {
  private readonly decks = new Map<SpeechTrigger, { bag: string[]; last: string }>();
  private readonly random: () => number;

  constructor(random: () => number = Math.random) {
    this.random = random;
  }

  next(trigger: SpeechTrigger): string {
    const lines = SPEECH.lines[trigger];
    const deck = this.decks.get(trigger);
    if (!deck) {
      const [first, ...rest] = lines;
      this.shuffle(rest);
      this.decks.set(trigger, { bag: rest, last: first });
      return first;
    }
    if (deck.bag.length === 0) {
      deck.bag = [...lines];
      this.shuffle(deck.bag);
      const lastIndex = deck.bag.length - 1;
      // 使い切った直後も、直前の台詞を続けて出さない
      if (deck.bag[lastIndex] === deck.last) {
        const swap = Math.floor(this.random() * lastIndex);
        [deck.bag[lastIndex], deck.bag[swap]] = [deck.bag[swap], deck.bag[lastIndex]];
      }
    }
    deck.last = deck.bag.pop()!;
    return deck.last;
  }

  private shuffle(bag: string[]): void {
    for (let i = bag.length - 1; i > 0; i--) {
      const j = Math.floor(this.random() * (i + 1));
      [bag[i], bag[j]] = [bag[j], bag[i]];
    }
  }
}

export const SPEECH_CHARS = [
  ...new Set(
    Array.from(Object.values(SPEECH.lines).flat().join("")).filter(
      (char) => char.charCodeAt(0) > 127,
    ),
  ),
].join("");

export function parseBubbleStyle(value: string | null): BubbleStyle | undefined {
  return value === "a" || value === "b" || value === "c" ? value : undefined;
}

type Side = typeof SPEECH.side;

interface BubblePlacement {
  headX: number;
  headY: number;
  headRadius: number;
  bubbleWidth: number;
  bubbleHeight: number;
  width: number;
  height: number;
  insets: { left: number; right: number; top: number; bottom: number };
  side: Side;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(value, max));
}

export function placeBubble(input: BubblePlacement) {
  const { headX, headY, headRadius, bubbleWidth, bubbleHeight, width, height, insets } = input;
  const { left, top } = insets;
  const right = Math.max(left, width - insets.right);
  const bottom = Math.max(top, height - insets.bottom);
  // 余白の内側に入りきらない幅や高さなら、文字と形を一緒に縮める
  const fit = Math.max(0, Math.min(1, (right - left) / bubbleWidth, (bottom - top) / bubbleHeight));
  const w = bubbleWidth * fit;
  const h = bubbleHeight * fit;
  const clearance = headRadius * (1 + SPEECH.headGapRatio);
  const sideX = { right: headX + clearance, left: headX - clearance - w };
  const fits = (side: Side) => sideX[side] >= left && sideX[side] + w <= right;
  const other = input.side === "right" ? "left" : "right";
  const side = fits(input.side) ? input.side : other;
  const x = clamp(sideX[side], left, right - w);
  const y = clamp(headY - clearance - h, top, bottom - h);

  // 吹き出しに最も近い頭の縁を指す。画面端ではしっぽも余白の内側に置く
  const dx = clamp(headX, x, x + w) - headX;
  const dy = clamp(headY, y, y + h) - headY;
  const angle = dx === 0 && dy === 0 ? (side === "right" ? 0 : Math.PI) : Math.atan2(dy, dx);
  return {
    x,
    y,
    side,
    fit,
    tailTip: {
      x: clamp(headX + Math.cos(angle) * headRadius, left, right),
      y: clamp(headY + Math.sin(angle) * headRadius, top, bottom),
    },
  };
}

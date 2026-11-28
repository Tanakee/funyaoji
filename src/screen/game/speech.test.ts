import { describe, expect, it } from "vite-plus/test";
import { SIT_MS } from "./sim.ts";
import {
  parseBubbleStyle,
  placeBubble,
  SPEECH,
  SPEECH_CHARS,
  SpeechPicker,
  speechTrigger,
} from "./speech.ts";

describe("speechTrigger", () => {
  const fell = { outcome: "fell", distanceM: 0 } as const;

  it("座り込みの閾値以上で sat を返す", () => {
    expect(speechTrigger(fell, SIT_MS - 1)).toBe("fell");
    expect(speechTrigger(fell, SIT_MS)).toBe("sat");
    expect(speechTrigger(fell, SIT_MS + 1)).toBe("sat");
  });

  it("座り込みの時間にかかわらずゴールを優先する", () => {
    expect(speechTrigger({ outcome: "goal", distanceM: 10, timeMs: 1_000 }, SIT_MS)).toBe("goal");
  });
});

describe("台詞", () => {
  const triggers = ["fell", "sat", "goal"] as const;

  it.each(triggers)("%s の台詞は2行・1行20字以内", (trigger) => {
    for (const text of SPEECH.lines[trigger]) {
      const lines = text.split("\n");
      expect(lines.length).toBeLessThanOrEqual(SPEECH.maxLines);
      for (const line of lines)
        expect(Array.from(line).length).toBeLessThanOrEqual(SPEECH.maxCharsPerLine);
    }
  });

  it("フォントの読み込みには全表の非ASCII文字を重複なく渡す", () => {
    const chars = Array.from(SPEECH_CHARS);
    const lines = Object.values(SPEECH.lines).flat().join("");
    expect(chars).toHaveLength(new Set(chars).size);
    expect(new Set(chars)).toEqual(new Set(Array.from(lines).filter((char) => char > "\x7f")));
  });

  it("終わり方ごとに先頭から始め、全台詞を使い切るまで繰り返さない", () => {
    let seed = 173;
    const picker = new SpeechPicker(() => {
      seed = (Math.imul(seed, 1_664_525) + 1_013_904_223) >>> 0;
      return seed / 2 ** 32;
    });
    const results = { fell: [] as string[], sat: [] as string[], goal: [] as string[] };
    for (let i = 0; i < 40; i++) {
      for (const trigger of triggers) results[trigger].push(picker.next(trigger));
    }
    for (const trigger of triggers) {
      const lines = SPEECH.lines[trigger];
      const picked = results[trigger];
      expect(picked[0]).toBe(lines[0]);
      for (let i = 0; i < picked.length; i += lines.length) {
        expect(new Set(picked.slice(i, i + lines.length))).toEqual(new Set(lines));
      }
      for (let i = 1; i < picked.length; i++) expect(picked[i]).not.toBe(picked[i - 1]);
    }
  });

  it("袋を詰め直した先頭が直前と同じ場合も続けて出さない", () => {
    const picker = new SpeechPicker(() => 0.99);
    const [first, second] = SPEECH.lines.goal;
    expect(Array.from({ length: 4 }, () => picker.next("goal"))).toEqual([
      first,
      second,
      first,
      second,
    ]);
  });
});

describe("parseBubbleStyle", () => {
  it("a、b、c だけを受け付ける", () => {
    for (const style of ["a", "b", "c"]) expect(parseBubbleStyle(style)).toBe(style);
    for (const style of [null, "", "B", "d"]) expect(parseBubbleStyle(style)).toBeUndefined();
  });
});

describe("placeBubble", () => {
  const frame = {
    headX: 510,
    headY: 330,
    headRadius: 30,
    bubbleWidth: 320,
    bubbleHeight: 84,
    width: 1280,
    height: 720,
    insets: { left: 54, right: 54, top: 40, bottom: 120 },
    side: "right",
  } as const;

  it("頭の右上に置き、頭の縁を指す", () => {
    const bubble = placeBubble(frame);
    expect(bubble.side).toBe("right");
    expect(bubble.x).toBeGreaterThan(frame.headX + frame.headRadius);
    expect(bubble.y + frame.bubbleHeight).toBeLessThan(frame.headY - frame.headRadius);
    expect(bubble.tailTip.x).toBeGreaterThan(frame.headX);
    expect(bubble.tailTip.y).toBeLessThan(frame.headY);
    expect(Math.hypot(bubble.tailTip.x - frame.headX, bubble.tailTip.y - frame.headY)).toBeCloseTo(
      frame.headRadius,
    );
  });

  it("右端では左側に出す", () => {
    const bubble = placeBubble({ ...frame, headX: 1140 });
    expect(bubble.side).toBe("left");
    expect(bubble.x + frame.bubbleWidth).toBeLessThan(1140 - frame.headRadius);
  });

  it("左を希望していて左端に近いときは右側に出す", () => {
    const bubble = placeBubble({ ...frame, headX: 90, side: "left" });
    expect(bubble.side).toBe("right");
    expect(bubble.x).toBeGreaterThan(90 + frame.headRadius);
  });

  it("頭が上端に寄っても上の余白より内側に置く", () => {
    const bubble = placeBubble({ ...frame, headY: 30 });
    expect(bubble.y).toBe(frame.insets.top);
    expect(bubble.tailTip.y).toBeGreaterThanOrEqual(frame.insets.top);
  });

  it("地面の帯にかからないところまで下端を押し上げる", () => {
    const bubble = placeBubble({ ...frame, headY: 700 });
    expect(bubble.y + frame.bubbleHeight).toBe(frame.height - frame.insets.bottom);
    expect(bubble.tailTip.y).toBeLessThanOrEqual(frame.height - frame.insets.bottom);
  });

  it("頭の左右に入りきらないときも余白の内側に寄せる", () => {
    const width = 450;
    const bubble = placeBubble({ ...frame, width, headX: 225 });
    expect(bubble.side).toBe("left");
    expect(bubble.fit).toBe(1);
    expect(bubble.x).toBeGreaterThanOrEqual(frame.insets.left);
    expect(bubble.x + frame.bubbleWidth).toBeLessThanOrEqual(width - frame.insets.right);
  });

  it("余白の間より幅が広いときは収まる倍率に縮める", () => {
    const width = 300;
    const bubble = placeBubble({ ...frame, width, headX: 150 });
    expect(bubble.fit).toBeLessThan(1);
    expect(bubble.x).toBe(frame.insets.left);
    expect(bubble.x + frame.bubbleWidth * bubble.fit).toBeCloseTo(width - frame.insets.right);
  });
});

// コースに置く障害物（docs/game.md の「障害物モード」）。物理（sim.ts）と描画（view.ts）が同じ表を読む。
// DOM にも PixiJS にも依存しない
import type { Mode } from "../../shared/messages.ts";

/**
 * 地面に固定した箱。x は前の端（スタートラインからの m）、width は奥行き、height は地面からの高さ（m）。
 * hurdle は乗る所ではなく越えるもの、step は乗って進む段
 */
export interface Block {
  kind: "hurdle" | "step";
  x: number;
  width: number;
  height: number;
}

/** 階段。from から段を height ずつ count 段上り、上の面を topWidth 進んだあと、同じ段で下りる */
function stairs(from: number, count: number, tread: number, rise: number, topWidth: number) {
  const blocks: Block[] = [];
  for (let i = 0; i < count; i++) {
    blocks.push({ kind: "step", x: from + i * tread, width: tread, height: rise * (i + 1) });
  }
  const top = from + count * tread;
  blocks.push({ kind: "step", x: top, width: topWidth, height: rise * (count + 1) });
  for (let i = 0; i < count; i++) {
    blocks.push({
      kind: "step",
      x: top + topWidth + i * tread,
      width: tread,
      height: rise * (count - i),
    });
  }
  return blocks;
}

export const HURDLE = { width: 0.04, height: 0.04 } as const;
export const STAIR = { count: 2, tread: 0.6, rise: 0.04, topWidth: 1.2 } as const;

/** 障害物モードのコース。決まった場所に置く（毎回同じ） */
export const OBSTACLE_COURSE: readonly Block[] = [
  { kind: "hurdle", x: 2.5, ...HURDLE },
  ...stairs(4.5, STAIR.count, STAIR.tread, STAIR.rise, STAIR.topWidth),
  { kind: "hurdle", x: 8.8, ...HURDLE },
];

/** モードのコース。障害物の無いモードは空 */
export function courseFor(mode: Mode): readonly Block[] {
  return mode === "obstacle" ? OBSTACLE_COURSE : [];
}

/** x（m）の真上の、足元の面の高さ。障害物の無い所は地面（0） */
export function floorHeightAt(course: readonly Block[], x: number): number {
  let h = 0;
  for (const b of course) {
    if (x >= b.x && x <= b.x + b.width && b.height > h) h = b.height;
  }
  return h;
}

/** 画面に名前を出す障害物のまとまり。続いた段は1つの階段にする。x は真ん中、height はいちばん高い所（m） */
export interface Landmark {
  name: "ハードル" | "階段";
  x: number;
  height: number;
}

export function landmarks(course: readonly Block[]): Landmark[] {
  const out: Landmark[] = [];
  let run: { from: number; to: number; height: number } | undefined;
  const flush = () => {
    if (run) out.push({ name: "階段", x: (run.from + run.to) / 2, height: run.height });
    run = undefined;
  };
  for (const b of [...course].sort((a, c) => a.x - c.x)) {
    if (b.kind === "hurdle") {
      flush();
      out.push({ name: "ハードル", x: b.x + b.width / 2, height: b.height });
    } else if (run && Math.abs(b.x - run.to) < 1e-9) {
      run.to = b.x + b.width;
      run.height = Math.max(run.height, b.height);
    } else {
      flush();
      run = { from: b.x, to: b.x + b.width, height: b.height };
    }
  }
  flush();
  return out;
}

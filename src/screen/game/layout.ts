// docs/screens.md の「全画面に共通の決まり」。下の帯は、ボタンなどを置く地面の部分
export const SCREEN_LAYOUT = {
  baseWidth: 1280,
  baseHeight: 720,
  safeX: 54,
  safeY: 40,
  bandHeight: 120,
  scaleRange: [0.6, 2.2],
} as const;

export function screenScale(width: number, height: number): number {
  const {
    baseWidth,
    baseHeight,
    scaleRange: [min, max],
  } = SCREEN_LAYOUT;
  return Math.min(max, Math.max(min, Math.min(width / baseWidth, height / baseHeight)));
}

export function screenLayoutCssVars(): Record<string, string> {
  const { baseWidth, baseHeight, safeX, safeY, bandHeight, scaleRange } = SCREEN_LAYOUT;
  return {
    "--layout-base-w": String(baseWidth),
    "--layout-base-h": String(baseHeight),
    "--layout-safe-x": String(safeX),
    "--layout-safe-y": String(safeY),
    "--layout-band-h": String(bandHeight),
    "--layout-scale-min": String(scaleRange[0]),
    "--layout-scale-max": String(scaleRange[1]),
  };
}

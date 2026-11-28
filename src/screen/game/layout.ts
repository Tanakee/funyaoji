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

/**
 * 右下の「R やり直す」と運営のボタンの左端（px）。Canvas の目盛りの数字は、これより左に出す。
 * 式は screen.css の .operator-controls と .restart-hint にそろえる
 */
export function bottomRightControlsLeft(width: number, scale: number): number {
  const right = Math.min(width * 0.0421875, 81);
  const button = Math.min(84, Math.max(40, width * 0.04375));
  const buttons = 3 * button + 2 * 8;
  return width - right - buttons - 16 - 150 * scale;
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

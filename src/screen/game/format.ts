// HUD に出す数の書き方

/** 距離（m）。小数 1 桁で、後ろに進んだら負の値のまま。-0.0 とは書かない */
export function formatDistance(distanceM: number): string {
  const text = distanceM.toFixed(1);
  return text === "-0.0" ? "0.0" : text;
}

/** タイム（ms）を、秒の小数 2 桁で */
export function formatTime(elapsedMs: number): string {
  return (elapsedMs / 1000).toFixed(2);
}

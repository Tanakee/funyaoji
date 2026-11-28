// 画面を消さない。スマホが眠ると接続が切れて、プレイが終わる

/**
 * 画面の消灯を止める。裏に回ると外れるので、表に戻ったらもう一度取る。
 * 非対応のブラウザや、断られたときは、何もしない。戻り値で手放す
 */
export function holdWakeLock(): () => void {
  let sentinel: WakeLockSentinel | undefined;
  let held = true;

  const request = async () => {
    if (!held || document.visibilityState !== "visible") return;
    if (sentinel !== undefined && !sentinel.released) return;
    try {
      const next = await navigator.wakeLock?.request("screen");
      if (next === undefined) return;
      // 待っているあいだに手放していたら、すぐ返す
      if (!held) void next.release();
      else sentinel = next;
    } catch {
      // 省電力モードなどで断られる。眠るかもしれないが、遊べはする
    }
  };
  const onVisibilityChange = () => void request();

  document.addEventListener("visibilitychange", onVisibilityChange);
  void request();
  return () => {
    held = false;
    document.removeEventListener("visibilitychange", onVisibilityChange);
    void sentinel?.release();
    sentinel = undefined;
  };
}

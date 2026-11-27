// 傾きを読み、毎秒30回ほど送る。1イベントごとの処理なので、React の外に置く

/** tilt を送る間隔（docs/api.md の設計方針は毎秒30回） */
export const TILT_INTERVAL_MS = 1000 / 30;
/** 傾きの範囲（度）。0 が水平、90 が手前に立てた状態 */
export const MIN_ANGLE = 0;
export const MAX_ANGLE = 90;

/** deviceorientation の beta を、0〜90度に収める。読めない値は undefined */
export function toAngle(beta: number | null | undefined): number | undefined {
  if (beta === null || beta === undefined || !Number.isFinite(beta)) return undefined;
  return Math.min(MAX_ANGLE, Math.max(MIN_ANGLE, beta));
}

/** 最後に読めた角度。まだ読めていなければ undefined。ゲージが毎フレーム読む */
let latest: number | undefined;
export function latestAngle(): number | undefined {
  return latest;
}

function onOrientation(event: DeviceOrientationEvent): void {
  // スマホは、値が null のイベントを1回送ってくる。読めない値は無視し、前の角度を保つ
  const angle = toAngle(event.beta);
  if (angle !== undefined) latest = angle;
}

/** 傾きを読み始める。戻り値で止める */
export function startReadingTilt(): () => void {
  latest = undefined;
  window.addEventListener("deviceorientation", onOrientation);
  return () => {
    window.removeEventListener("deviceorientation", onOrientation);
    latest = undefined;
  };
}

/** 傾きの読み取りの許可を求める。要らない環境（Android など）は許可済みとして扱う。タップの中で呼ぶこと */
export async function requestTiltPermission(): Promise<boolean> {
  const Orientation = globalThis.DeviceOrientationEvent as
    | (typeof DeviceOrientationEvent & { requestPermission?: () => Promise<PermissionState> })
    | undefined;
  if (typeof Orientation?.requestPermission !== "function") return true;
  try {
    return (await Orientation.requestPermission()) === "granted";
  } catch {
    // HTTPS でないときや、タップの外で呼んだときに投げる
    return false;
  }
}

/**
 * 開いているあいだ、最新の角度を一定の間隔で送る。
 * 角度が変わらなくても送る。スクリーンは直近0.5秒に tilt を受け取った関節を「入力あり」にする
 */
export function startSendingTilt(
  nextSeq: () => number,
  send: (message: { type: "tilt"; seq: number; angle: number }) => boolean,
): () => void {
  const timer = setInterval(() => {
    if (latest === undefined) return;
    send({ type: "tilt", seq: nextSeq(), angle: latest });
  }, TILT_INTERVAL_MS);
  return () => clearInterval(timer);
}

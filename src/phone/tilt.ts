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

/**
 * 1回のイベントでこれより大きく変わった角度（度）は、飛んだ値とみなす。
 * deviceorientation は毎秒60回ほど届くので、手で速く振っても1回で動くのは十数度まで
 */
export const MAX_JUMP = 45;

/**
 * 飛んだ値を捨てる。前の角度から MAX_JUMP より大きく離れた値は、1回だけ保留して使わない。
 * 次の値も保留した値の近くにあれば、本当に動いたとみなして使う。2回続けば受け入れるので、保留したまま止まらない
 */
export class JumpFilter {
  private last: number | undefined;
  private pending: number | undefined;

  /** 使う角度。飛んだ値で、保留しただけなら undefined */
  accept(angle: number): number | undefined {
    if (this.last === undefined || Math.abs(angle - this.last) <= MAX_JUMP) {
      return this.use(angle);
    }
    if (this.pending !== undefined && Math.abs(angle - this.pending) <= MAX_JUMP) {
      return this.use(angle);
    }
    this.pending = angle;
    return undefined;
  }

  private use(angle: number): number {
    this.last = angle;
    this.pending = undefined;
    return angle;
  }
}

/**
 * 最後に読めた角度。まだ読めていなければ undefined。ゲージと糸が毎フレーム読み、startSendingTilt が送る。
 * カメラで遊ぶときは、傾きの代わりにカメラ（camera/camera.ts）が、指の曲げを同じ 0〜90度にして書く
 */
let latest: number | undefined;
let filter = new JumpFilter();
export function latestAngle(): number | undefined {
  return latest;
}

/** 傾き以外の入力（カメラ）が、送る角度を書く。読めていなければ undefined */
export function setLatestAngle(angle: number | undefined): void {
  latest = angle;
}

function onOrientation(event: DeviceOrientationEvent): void {
  // スマホは、値が null のイベントを1回送ってくる。読めない値は無視し、前の角度を保つ
  const angle = toAngle(event.beta);
  if (angle === undefined) return;
  // 飛んだ値も無視し、前の角度を保つ
  const accepted = filter.accept(angle);
  if (accepted !== undefined) latest = accepted;
}

/** 傾きを読み始める。戻り値で止める */
export function startReadingTilt(): () => void {
  latest = undefined;
  filter = new JumpFilter();
  window.addEventListener("deviceorientation", onOrientation);
  return () => {
    window.removeEventListener("deviceorientation", onOrientation);
    latest = undefined;
  };
}

function getTiltPermissionRequest() {
  const Orientation = globalThis.DeviceOrientationEvent as
    | (typeof DeviceOrientationEvent & { requestPermission?: () => Promise<PermissionState> })
    | undefined;
  return typeof Orientation?.requestPermission === "function"
    ? Orientation.requestPermission.bind(Orientation)
    : undefined;
}

/** 傾きを読む前に、許可の確認が出る環境か（iOS の Safari など、requestPermission がある） */
export function needsTiltPermission(): boolean {
  return getTiltPermissionRequest() !== undefined;
}

/** 傾きの読み取りの許可を求める。要らない環境（Android など）は許可済みとして扱う。タップの中で呼ぶこと */
export async function requestTiltPermission(): Promise<boolean> {
  const requestPermission = getTiltPermissionRequest();
  if (requestPermission === undefined) return true;
  try {
    return (await requestPermission()) === "granted";
  } catch {
    // HTTPS でないときや、タップの外で呼んだときに投げる
    return false;
  }
}

/**
 * 傾きが届くかを待つ時間。スマホは許可のあとすぐ（数十ms で）毎秒60回ほど届き始める。
 * PC のブラウザは、値が null のイベントを1回送るか、何も送らない
 */
export const TILT_CHECK_TIMEOUT_MS = 2_000;

/**
 * 読める傾き（beta が数）が届けば true、timeoutMs のうちに届かなければ false。
 * 傾きを読み取れない端末を、ルームにつなぐ前に見分ける。許可のあとに呼ぶこと。
 * 裏に回ったページには傾きが届かないので、表に出ているあいだだけ数え、表に戻ったら数え直す
 */
export function waitForTilt(timeoutMs = TILT_CHECK_TIMEOUT_MS): Promise<boolean> {
  return new Promise((resolve) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = (supported: boolean) => {
      clearTimeout(timer);
      window.removeEventListener("deviceorientation", onEvent);
      document.removeEventListener("visibilitychange", restart);
      resolve(supported);
    };
    const onEvent = (event: DeviceOrientationEvent) => {
      if (toAngle(event.beta) !== undefined) finish(true);
    };
    const restart = () => {
      clearTimeout(timer);
      timer =
        document.visibilityState === "visible"
          ? setTimeout(() => finish(false), timeoutMs)
          : undefined;
    };
    window.addEventListener("deviceorientation", onEvent);
    document.addEventListener("visibilitychange", restart);
    restart();
  });
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

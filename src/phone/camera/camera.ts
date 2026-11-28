// 前面カメラに映した人差し指の曲げを読み、傾きと同じ角度（0〜90度）にして書く（docs/game.md の「操作方法」）。
// 1フレームごとの処理なので、React の外に置く。React には、状態（CameraSnapshot）だけを渡す
import type { HandLandmarker } from "@mediapipe/tasks-vision";
// WASM とモデルは、自分のサイトから配る。会場の回線で外の CDN に頼らない（docs/design.md の「決定の記録」）
import wasmLoaderPath from "@mediapipe/tasks-vision/vision_wasm_internal.js?url";
import wasmBinaryPath from "@mediapipe/tasks-vision/vision_wasm_internal.wasm?url";
import modelAssetPath from "./hand_landmarker.task?url";
import { fingerAngle } from "./finger.ts";

/**
 * off：使っていない。starting：カメラの許可を待っている。loading：映像は出ていて、指を読むモデルを読み込んでいる。
 * running：指を読んでいる。
 * denied：カメラが許可されなかった。unavailable：カメラが無い・使えない（HTTPS でないときも）。failed：モデルを動かせなかった
 */
export type CameraStatus =
  | "off"
  | "starting"
  | "loading"
  | "running"
  | "denied"
  | "unavailable"
  | "failed";

export interface CameraSnapshot {
  status: CameraStatus;
  /** 画面に映すカメラの映像。loading と running のとき */
  stream: MediaStream | undefined;
  /** 直近のフレームで手が映っていた */
  handVisible: boolean;
}

const OFF: CameraSnapshot = { status: "off", stream: undefined, handVisible: false };
let snapshot = OFF;
const listeners = new Set<() => void>();

function update(patch: Partial<CameraSnapshot>): void {
  snapshot = { ...snapshot, ...patch };
  for (const listener of listeners) listener();
}

// useSyncExternalStore に渡す
export function subscribeCamera(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
export function getCameraSnapshot(): CameraSnapshot {
  return snapshot;
}

/**
 * 手のモデル。読み込みに数秒かかるので、一度作ったら、カメラを止めても持っておく。
 * ロビーで傾きとカメラを切り替えても、読み込み直さない
 */
let landmarker: Promise<HandLandmarker> | undefined;

function loadLandmarker(): Promise<HandLandmarker> {
  landmarker ??= (async () => {
    const { HandLandmarker } = await import("@mediapipe/tasks-vision");
    const create = (delegate: "GPU" | "CPU") =>
      HandLandmarker.createFromOptions(
        { wasmLoaderPath, wasmBinaryPath },
        { baseOptions: { modelAssetPath, delegate }, runningMode: "VIDEO", numHands: 1 },
      );
    // GPU を使えない端末は CPU で動かす
    return create("GPU").catch(() => create("CPU"));
  })();
  // 失敗したら、次に始めるときに読み込み直す
  landmarker.catch(() => {
    landmarker = undefined;
  });
  return landmarker;
}

/**
 * 前面カメラで指を読み始める。読めた角度を write に渡す。手が映っていなければ 0、まだ読めていなければ undefined。
 * 戻り値で止める
 */
export function startCamera(write: (angle: number | undefined) => void): () => void {
  let stopped = false;
  let frame = 0;
  let stream: MediaStream | undefined;
  let video: HTMLVideoElement | undefined;
  write(undefined);
  update({ status: "starting", stream: undefined, handVisible: false });

  const run = async () => {
    if (navigator.mediaDevices?.getUserMedia === undefined) {
      update({ status: "unavailable" });
      return;
    }
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        // 小さい映像で足りる。大きいと、指を読むのが遅くなる
        video: { facingMode: "user", width: { ideal: 320 }, height: { ideal: 240 } },
        audio: false,
      });
    } catch (error) {
      if (stopped) return;
      const denied = error instanceof DOMException && error.name === "NotAllowedError";
      update({ status: denied ? "denied" : "unavailable" });
      return;
    }
    if (stopped) {
      stopTracks();
      return;
    }
    // 指を読む映像。画面に映す映像（CameraPreview）とは別にし、画面が切り替わっても読み続ける。
    // iOS は、ページに置いていない映像を再生しないことがあるので、見えない形で置く
    video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.setAttribute("aria-hidden", "true");
    video.style.cssText =
      "position:fixed;left:0;top:0;width:1px;height:1px;opacity:0;pointer-events:none";
    video.srcObject = stream;
    document.body.appendChild(video);
    // モデルの読み込みには数秒かかる。先に映像を出し、待っていることが分かるようにする
    update({ status: "loading", stream });
    let hands: HandLandmarker;
    try {
      [hands] = await Promise.all([loadLandmarker(), video.play()]);
    } catch (error) {
      if (stopped) return;
      console.error("指を読む準備ができませんでした", error);
      update({ status: "failed" });
      return;
    }
    if (stopped) return;
    update({ status: "running", stream });

    let lastTime = -1;
    const tick = () => {
      frame = requestAnimationFrame(tick);
      // 新しいフレームが来たときだけ読む。カメラは毎秒30回ほど、画面の描き直しは60回ほど
      if (video === undefined || video.readyState < 2 || video.currentTime === lastTime) return;
      lastTime = video.currentTime;
      const result = hands.detectForVideo(video, performance.now());
      const hand = result.worldLandmarks[0];
      write(fingerAngle(hand));
      const handVisible = hand !== undefined;
      if (handVisible !== snapshot.handVisible) update({ handVisible });
    };
    tick();
  };

  const stopTracks = () => {
    for (const track of stream?.getTracks() ?? []) track.stop();
  };

  void run();
  return () => {
    stopped = true;
    cancelAnimationFrame(frame);
    stopTracks();
    video?.remove();
    write(undefined);
    update(OFF);
  };
}

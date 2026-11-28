import { useEffect, useRef, useSyncExternalStore } from "react";
import { getCameraSnapshot, subscribeCamera, type CameraStatus } from "./camera.ts";

/** 映像の代わりに出す文。running で手が映っているときは出さない */
const STATUS_TEXT: Record<Exclude<CameraStatus, "running">, string> = {
  off: "カメラを起動中...",
  starting: "カメラを起動中...",
  loading: "読み込み中...（はじめは少し時間がかかります）",
  denied: "カメラが許可されていません。ブラウザの設定でカメラを許可して、読み込み直してください",
  unavailable: "カメラを使えません。ほかのスマホで参加してください",
  failed: "指を読み取れませんでした。ページを読み込み直してください",
};

/** 前面カメラの映像。鏡のように左右を反転して映し、自分の手を見ながら動かせるようにする */
export function CameraPreview() {
  const { status, stream, handVisible } = useSyncExternalStore(subscribeCamera, getCameraSnapshot);
  const video = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const element = video.current;
    if (element === null) return;
    element.srcObject = stream ?? null;
    if (stream) void element.play().catch(() => {});
  }, [stream]);

  const text =
    status !== "running"
      ? STATUS_TEXT[status]
      : handVisible
        ? undefined
        : "手が映っていません。人差し指をカメラに向けて";
  return (
    <div className="camera-preview" data-status={status}>
      <video ref={video} muted playsInline aria-label="前面カメラの映像" />
      {text !== undefined ? <p className="camera-preview-text">{text}</p> : null}
    </div>
  );
}

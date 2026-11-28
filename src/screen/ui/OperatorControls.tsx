import { useEffect, useRef, useState } from "react";
import type { ScreenSession, ScreenView } from "./session.ts";

/** S2〜S7 と待つ画面に共通の操作。ルームの寿命はセッションが持つ。 */
export function OperatorControls({ session, view }: { session: ScreenSession; view: ScreenView }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [fullscreen, setFullscreen] = useState(Boolean(document.fullscreenElement));
  const [fullscreenError, setFullscreenError] = useState("");
  const container = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const action = useRef<HTMLButtonElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const busy = view.recreation.status === "creating" || view.recreation.status === "closing";
  const canRecreate =
    view.room.status === "ready" && view.room.connection.status === "open" && !busy;
  const isErrorScreen =
    view.game === "failed" ||
    view.room.status === "failed" ||
    (view.room.status === "ready" &&
      (view.room.connection.status === "closed" || view.room.rejected !== undefined));

  useEffect(() => {
    const changed = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", changed);
    return () => document.removeEventListener("fullscreenchange", changed);
  }, []);
  useEffect(() => {
    if (!menuOpen) return;
    action.current?.focus();
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !container.current?.contains(event.target))
        setMenuOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [menuOpen]);
  useEffect(() => {
    if (isErrorScreen) {
      setMenuOpen(false);
      dialog.current?.close();
    }
  }, [isErrorScreen]);

  const toggleFullscreen = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
      setFullscreenError("");
    } catch {
      setFullscreenError("全画面にできませんでした");
    }
  };
  if (isErrorScreen) {
    return view.recreation.status === "failed" ? (
      <div className="operator-failure" role="alert">
        <h1>ルームの接続が終了しました</h1>
        <p>{view.recreation.message}</p>
        <button type="button" onClick={() => location.reload()}>
          読み込み直す
        </button>
      </div>
    ) : null;
  }
  return (
    <div
      ref={container}
      className={`operator-controls${view.flow.kind === "playing" || view.flow.kind === "finish" ? " operator-controls--playing" : ""}`}
    >
      {view.recreation.status === "failed" && (
        <p className="operator-notice" role="alert">
          {view.recreation.message}
        </p>
      )}
      {fullscreenError && (
        <p className="operator-notice" role="alert">
          {fullscreenError}
        </p>
      )}
      <div className="operator-buttons" aria-label="運営の操作">
        <button
          ref={trigger}
          type="button"
          aria-label="運営のメニュー"
          title="運営のメニュー"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          disabled={view.room.status !== "ready" || busy}
          onClick={() => setMenuOpen(!menuOpen)}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") {
              event.preventDefault();
              setMenuOpen(true);
            }
          }}
        >
          <span aria-hidden="true">⚙</span>
        </button>
        <button
          type="button"
          aria-label={fullscreen ? "全画面を戻す" : "全画面にする"}
          title={fullscreen ? "全画面を戻す" : "全画面にする"}
          onClick={() => void toggleFullscreen()}
        >
          <span aria-hidden="true">⛶</span>
        </button>
        <button
          type="button"
          aria-label={view.audio.muted ? "音を出す" : "音を消す"}
          title={view.audio.muted ? "音を出す（M）" : "音を消す（M）"}
          aria-pressed={view.audio.muted}
          onClick={() => session.toggleMute()}
        >
          <span aria-hidden="true">{view.audio.muted ? "🔇" : "🔊"}</span>
        </button>
      </div>
      {menuOpen && (
        <div
          className="operator-menu"
          role="menu"
          aria-label="運営のメニュー"
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              setMenuOpen(false);
              trigger.current?.focus();
            }
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              action.current?.focus();
            }
            if (event.key === "Tab") setMenuOpen(false);
          }}
        >
          <button
            ref={action}
            type="button"
            role="menuitem"
            disabled={!canRecreate}
            onClick={() => {
              setMenuOpen(false);
              dialog.current?.showModal();
            }}
          >
            ルームを作り直す
          </button>
          {!canRecreate && <p>接続を待ってから操作してください</p>}
        </div>
      )}
      <p className="operator-audio-status" role="status">
        {busy
          ? "ルームを作り直しています"
          : view.audio.unavailable
            ? "音を利用できません"
            : !view.audio.ready && !view.audio.muted
              ? "キーかクリックで音を有効にする"
              : ""}
      </p>
      <dialog
        ref={dialog}
        className="operator-dialog"
        aria-labelledby="reset-room-title"
        aria-describedby="reset-room-description"
        onClose={() => trigger.current?.focus()}
      >
        <h2 id="reset-room-title">ルームを作り直しますか？</h2>
        <p id="reset-room-description">
          今の参加者との接続を終了し、
          <br />
          新しいQRとルームコードを表示します。
        </p>
        <div className="operator-dialog-actions">
          <button type="button" autoFocus onClick={() => dialog.current?.close()}>
            キャンセル
          </button>
          <button
            type="button"
            onClick={() => {
              dialog.current?.close();
              void session.recreateRoom();
            }}
          >
            作り直す
          </button>
        </div>
      </dialog>
    </div>
  );
}

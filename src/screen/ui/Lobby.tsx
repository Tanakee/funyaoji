import type { ConnectionState } from "../../net/client.ts";
import { TEAM_NAME_MAX_LENGTH } from "../../shared/api.ts";
import { JOINT_DISPLAY } from "../../shared/joints.ts";
import { JOINTS } from "../../shared/messages.ts";
import { isFull } from "./flow.ts";
import { QrCode } from "./QrCode.tsx";
import { canOperate, type RoomState, type ScreenSession, type ScreenView } from "./session.ts";

export function Lobby({ session, view }: { session: ScreenSession; view: ScreenView }) {
  const { room, joints } = view;
  const full = isFull(joints);
  const ready = full && view.teamName !== undefined;
  const notice = noticeText(view);
  return (
    <main className="overlay lobby">
      <header className="screen-header">
        <div className="brand-mark" aria-hidden="true">
          ふ
        </div>
        <div className="brand-name">ふにゃおじ</div>
        <span className="header-mode">10m モード</span>
      </header>

      <div className="lobby-layout">
        <section className="lobby-join" aria-label="参加の方法">
          <p className="lobby-lead">スマホで QR コードを読んで参加</p>
          {room.status === "ready" ? (
            <Join roomCode={room.roomCode} />
          ) : (
            <RoomPending room={room} />
          )}
        </section>

        <section className="lobby-players" aria-label="参加している人">
          <h1 className="lobby-count">
            <strong>{joints.length}</strong> / {JOINTS.length} 人
          </h1>
          <ul className="slots">
            {JOINTS.map((joint) => {
              const filled = joints.includes(joint);
              return (
                <li key={joint} className={`slot ${filled ? "slot--filled" : "slot--empty"}`}>
                  <span className="slot-joint">{JOINT_DISPLAY[joint].name}</span>
                  <span className="slot-state">{filled ? "参加中" : "空き"}</span>
                </li>
              );
            })}
          </ul>

          <div className="lobby-start">
            <p className={ready ? "start-row start-row--ready" : "start-row"}>
              <kbd>Space</kbd>
              <span>
                {full
                  ? ready
                    ? "押して開始"
                    : "チーム名を入れてから開始"
                  : "4人そろったら、押して開始"}
              </span>
            </p>
            <p className="start-row start-row--debug">
              <kbd>Enter</kbd>
              <span>デバッグ開始（空きの関節はキーボード操作）</span>
            </p>
            {view.debug.enabled && (
              // 画面のタップ・クリックで、Enter と同じ開始。空きの関節は、ゲームの下のつまみで動かす
              <button
                type="button"
                className="debug-button debug-button--start"
                disabled={!canOperate(view)}
                onClick={() => session.startDebug()}
              >
                デバッグ開始
              </button>
            )}
          </div>
        </section>
      </div>

      <footer className="lobby-settings">
        <div className="team-name-field">
          <label htmlFor="team-name">チーム名</label>
          <input
            id="team-name"
            type="text"
            required
            value={view.teamNameInput}
            onChange={(event) => session.setTeamName(event.target.value)}
            aria-invalid={Boolean(view.teamNameError)}
            aria-describedby="team-name-message"
            autoComplete="off"
            placeholder={`1〜${TEAM_NAME_MAX_LENGTH}文字`}
          />
          <p id="team-name-message" role="status">
            {view.teamNameError ?? `ランキングに使う名前（${TEAM_NAME_MAX_LENGTH}文字まで）`}
          </p>
        </div>
        <span className="lobby-mode">10m モード</span>
      </footer>
      {notice && <p className="lobby-notice">{notice}</p>}
    </main>
  );
}

function Join({ roomCode }: { roomCode: string }) {
  const url = new URL("/play", location.href);
  url.searchParams.set("room", roomCode);
  return (
    <>
      <QrCode text={url.href} />
      <div className="room-code">
        <span className="room-code-label">ルームコード</span>
        <strong className="room-code-value">{roomCode}</strong>
      </div>
    </>
  );
}

function RoomPending({ room }: { room: Exclude<RoomState, { status: "ready" }> }) {
  return (
    <p className="room-pending">
      {room.status === "creating"
        ? "ルームを作成中"
        : `ルームを作成できません（${room.message}）。ページを読み込み直してください`}
    </p>
  );
}

/** ロビーの下に出す、うまくいっていないときの知らせ */
function noticeText(view: ScreenView): string | undefined {
  if (view.game === "failed") return "ゲームを読み込めませんでした。ページを読み込み直してください";
  if (view.room.status === "ready") {
    const text = connectionNotice(view.room.connection, view.room.rejected);
    if (text) return text;
  }
  if (view.game === "loading") return "ゲームを読み込み中";
  return undefined;
}

/** 断られた理由（docs/api.md の rejected）を、画面に出す言葉にする */
const REJECT_TEXT: Record<string, string> = {
  full: "満員です",
  playing: "プレイ中です",
  "no-room": "ルームがありません",
};

function connectionNotice(
  state: ConnectionState,
  rejected: string | undefined,
): string | undefined {
  switch (state.status) {
    case "connecting":
      return "サーバーにつないでいます";
    case "open":
      return undefined;
    case "reconnecting":
      return `サーバーとの接続が切れたので、つなぎ直しています（${state.attempt}回目）`;
    case "closed":
      return `サーバーとの接続が切れました（${rejected ? (REJECT_TEXT[rejected] ?? rejected) : `close コード ${state.code}`}）。ページを読み込み直してください`;
  }
}

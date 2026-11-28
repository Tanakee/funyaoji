import { TEAM_NAME_MAX_LENGTH } from "../../shared/api.ts";
import {
  INPUT_METHODS,
  JOINTS,
  MODES,
  type InputMethod,
  type Mode,
} from "../../shared/messages.ts";
import { isFull } from "./flow.ts";
import { QrCode } from "./QrCode.tsx";
import { canOperate, type ScreenSession, type ScreenView } from "./session.ts";

/** モードの呼び名（docs/game.md の「モード」） */
export const MODE_LABELS: Record<Mode, string> = { normal: "ノーマル", hard: "ハード" };

/** 操作方法の呼び名（docs/game.md の「操作方法」） */
export const INPUT_LABELS: Record<InputMethod, string> = { tilt: "傾き", camera: "カメラ" };

/** ヘッダーに出す、モードと操作方法（ランキングはこの組ごとに分かれる） */
export function modeLabel(mode: Mode, input: InputMethod): string {
  return `${MODE_LABELS[mode]}モード・${INPUT_LABELS[input]}`;
}

export function Lobby({ session, view }: { session: ScreenSession; view: ScreenView }) {
  const { room, joints } = view;
  const full = isFull(joints);
  const ready = full && view.teamName !== undefined;
  return (
    <main className="overlay lobby">
      <header className="screen-header">
        <div className="brand-mark" aria-hidden="true">
          ふ
        </div>
        <div className="brand-name">ふにゃおじ</div>
        <span className="header-mode">{modeLabel(view.mode, view.input)}</span>
      </header>

      <div className="lobby-layout">
        <section className="lobby-join" aria-label="参加の方法">
          <p className="lobby-lead">スマホで QR コードを読んで参加</p>
          {room.status === "ready" && <Join roomCode={room.roomCode} />}
        </section>

        <section className="lobby-players" aria-label="参加している人">
          <h1 className="lobby-count">
            <strong>{joints.length}</strong> / {JOINTS.length} 人
          </h1>
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
        <fieldset className="input-field">
          <legend>モード</legend>
          {MODES.map((mode) => (
            <label key={mode} className="input-option">
              <input
                type="radio"
                name="mode"
                value={mode}
                checked={view.mode === mode}
                onChange={() => session.setMode(mode)}
              />
              <span>{MODE_LABELS[mode]}</span>
            </label>
          ))}
          <p>{view.mode === "normal" ? "いつものおじさん" : "転びやすいおじさん"}</p>
        </fieldset>
        <fieldset className="input-field">
          <legend>操作方法</legend>
          {INPUT_METHODS.map((input) => (
            <label key={input} className="input-option">
              <input
                type="radio"
                name="input-method"
                value={input}
                checked={view.input === input}
                onChange={() => session.setInputMethod(input)}
              />
              <span>{INPUT_LABELS[input]}</span>
            </label>
          ))}
          <p>
            {view.input === "tilt"
              ? "スマホを立てると糸が引かれる"
              : "前面カメラに映した人差し指を曲げると糸が引かれる"}
          </p>
        </fieldset>
      </footer>
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
      <p className="lobby-manual-url">QR を読めないとき：{url.origin}/play</p>
    </>
  );
}

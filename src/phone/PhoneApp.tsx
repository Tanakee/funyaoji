import { useEffect, useReducer, useRef, type ReactNode } from "react";
import { JOINTS, type PlayResult } from "../shared/messages.ts";
import { Gauge } from "./Gauge.tsx";
import { JOINT_LABELS } from "./joints.ts";
import { initialState, reduce, type PhoneState, type RejectReason } from "./model.ts";
import { startSession } from "./session.ts";
import { requestTiltPermission } from "./tilt.ts";

/** 全員そろう人数 */
const PLAYERS = JOINTS.length;

const REJECT_NOTICES: Record<RejectReason, { title: string; detail: string }> = {
  full: { title: "満員です", detail: "このルームは4人そろっています。" },
  playing: {
    title: "プレイ中です",
    detail: "いまのプレイが終わるまで待ってください。終わると自動で参加します。",
  },
  "no-room": {
    title: "ルームがありません",
    detail: "スクリーンの QR コードをもう一度読み取ってください。",
  },
};

const OUTCOME_LABELS: Record<PlayResult["outcome"], string> = {
  goal: "ゴール！",
  fell: "転倒",
  timeout: "タイムアウト",
  disconnected: "切断",
};

export function PhoneApp({ room }: { room: string | undefined }) {
  const [state, dispatch] = useReducer(reduce, room, initialState);
  const stopSession = useRef<(() => void) | undefined>(undefined);

  // ページを閉じるとき（と開発中の再読み込み）に、接続を閉じる
  useEffect(() => () => stopSession.current?.(), []);

  const join = async () => {
    if (room === undefined) return;
    dispatch({ type: "tap-join" });
    // iOS は、タップの中で許可を求める。await より前に呼ぶ
    const granted = await requestTiltPermission();
    dispatch({ type: "permission", granted });
    if (granted) {
      stopSession.current?.();
      stopSession.current = startSession(room, dispatch);
    }
  };

  return (
    <main className="app">
      <header className="top">
        <span className="brand">ふにゃおじ</span>
        {room !== undefined && <span className="room">ルーム {room}</span>}
      </header>
      <Body state={state} onJoin={join} />
    </main>
  );
}

function Body({ state, onJoin }: { state: PhoneState; onJoin: () => void }) {
  switch (state.kind) {
    case "invalid-room":
      return (
        <Notice title={REJECT_NOTICES["no-room"].title} detail={REJECT_NOTICES["no-room"].detail} />
      );
    case "ready":
      return (
        <Center>
          <p className="lead">スマホを傾けて、おじさんの関節を動かします。</p>
          <button className="big-button" type="button" onClick={onJoin}>
            参加
          </button>
        </Center>
      );
    case "asking-permission":
      return (
        <Center>
          <button className="big-button" type="button" disabled>
            参加
          </button>
          <p className="lead">傾きの読み取りの許可を確認しています。</p>
        </Center>
      );
    case "permission-denied":
      return (
        <Notice
          tone="danger"
          title="傾きの読み取りが許可されていません"
          detail="もう一度「参加」を押して「許可」を選んでください。許可の画面が出ないときは、Safari を終了して開き直し、QR コードを読み取り直してください。"
        >
          <button className="big-button" type="button" onClick={onJoin}>
            もう一度参加
          </button>
        </Notice>
      );
    case "connecting":
      return (
        <Center>
          <p className="lead">ルームにつないでいます…</p>
        </Center>
      );
    case "rejected":
      return (
        <Notice
          tone={state.reason === "playing" ? "warn" : "danger"}
          title={REJECT_NOTICES[state.reason].title}
          detail={REJECT_NOTICES[state.reason].detail}
        />
      );
    case "closed":
      return (
        <Notice
          tone="danger"
          title={state.replaced ? "別のタブで開かれました" : "接続が切れました"}
          detail={
            state.replaced
              ? "このタブは使えません。続けるには、読み込み直してください。"
              : "ページを読み込み直して、もう一度参加してください。"
          }
        >
          <button className="big-button" type="button" onClick={() => location.reload()}>
            読み込み直す
          </button>
        </Notice>
      );
    case "joined":
      return <Joined state={state} />;
  }
}

function Joined({ state }: { state: Extract<PhoneState, { kind: "joined" }> }) {
  const label = JOINT_LABELS[state.joint];
  const playing = state.phase.kind === "playing";
  return (
    <div className="joined" data-active={playing && state.active}>
      {state.link === "reconnecting" && <p className="banner">つなぎ直しています…</p>}
      <section className="joint">
        <p className="caption">あなたの担当</p>
        <h1 className="joint-name">{label.name}</h1>
        <p className="joint-hint">
          寝かせる＝{label.flat} ／ 立てる＝{label.upright}
        </p>
      </section>
      <Gauge />
      <section className="phase" data-phase={state.phase.kind}>
        {state.phase.kind === "lobby" && (
          <>
            <p className="phase-title">待機中</p>
            <p className="phase-detail">
              {state.count} / {PLAYERS} 人が参加中
            </p>
          </>
        )}
        {state.phase.kind === "playing" && (
          <>
            <p className="phase-title">プレイ中</p>
            <p className="input-status" data-active={state.active}>
              {state.active ? "入力が届いています" : "入力が届いていません"}
            </p>
          </>
        )}
        {state.phase.kind === "result" && <Result result={state.phase.result} />}
      </section>
    </div>
  );
}

function Result({ result }: { result: PlayResult }) {
  return (
    <>
      <p className="phase-title" data-outcome={result.outcome}>
        {OUTCOME_LABELS[result.outcome]}
      </p>
      <p className="phase-detail">
        {result.outcome === "goal" && `${(result.timeMs / 1000).toFixed(2)} 秒 ／ `}
        距離 {result.distanceM.toFixed(1)} m
      </p>
    </>
  );
}

function Center({ children }: { children: ReactNode }) {
  return <div className="center">{children}</div>;
}

function Notice({
  title,
  detail,
  tone = "danger",
  children,
}: {
  title: string;
  detail: string;
  tone?: "danger" | "warn";
  children?: ReactNode;
}) {
  return (
    <div className="center notice" data-tone={tone}>
      <h1 className="notice-title">{title}</h1>
      <p className="lead">{detail}</p>
      {children}
    </div>
  );
}

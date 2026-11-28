import { useEffect, useReducer, useRef, type ReactNode } from "react";
import { JOINTS, type PlayResult } from "../shared/messages.ts";
import { Gauge } from "./Gauge.tsx";
import { JOINT_LABELS } from "./joints.ts";
import { initialState, reduce, type PhoneState, type RejectReason } from "./model.ts";
import { Reconnecting } from "./Reconnecting.tsx";
import { startSession } from "./session.ts";
import { Notice, Waiting } from "./templates.tsx";
import { requestTiltPermission, waitForTilt } from "./tilt.ts";

/** 全員そろう人数 */
const PLAYERS = JOINTS.length;

interface NoticeText {
  title: string;
  reason: string;
  next?: string;
}

// 満員とプレイ中は、順番待ち（P2a）ができるまでの文言
const REJECT_NOTICES: Record<RejectReason, NoticeText> = {
  full: { title: "満員です", reason: "このルームは4人そろっています。" },
  playing: {
    title: "プレイ中です",
    reason: "いまのプレイが終わるまで待ってください。終わると自動で参加します。",
  },
  "no-room": {
    title: "ルームが見つかりません",
    reason: "このルームは、もう閉じたようです。",
    next: "スクリーンのQRをもう一度読み取ってください。",
  },
};

const PERMISSION_DENIED: NoticeText = {
  title: "スマホの傾きを使えません",
  reason: "傾きの読み取りが許可されませんでした。",
  next: "ブラウザを開き直して、傾きを許可してください。",
};

const UNSUPPORTED: NoticeText = {
  title: "この端末では遊べません",
  reason: "傾きを読み取れない端末です。",
  next: "ほかのスマホで、スクリーンのQRを読み取ってください。",
};

const CLOSED: Record<"replaced" | "lost", NoticeText> = {
  // 置き換えられて閉じるのは、前から開いていたタブ。遊べるのは、あとから開いたタブ
  replaced: { title: "別のタブで開いています", reason: "あとから開いたタブで遊んでください。" },
  lost: {
    title: "接続が切れました",
    reason: "もう一度遊ぶときは、スクリーンのQRを読み取ってください。",
  },
};

const OUTCOME_LABELS: Record<PlayResult["outcome"], string> = {
  goal: "ゴール！",
  fell: "転倒",
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
    if (!granted) return;
    // 傾きを読み取れない端末は、ルームにつながない。つなぐと席を1つ取ってしまう
    const supported = await waitForTilt();
    dispatch({ type: "tilt-check", supported });
    if (!supported) return;
    stopSession.current?.();
    stopSession.current = startSession(room, dispatch);
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
      return <Notice {...REJECT_NOTICES["no-room"]} />;
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
      // iOS は、ブラウザを開き直すまで許可の画面を出さない。開き直し方を知らない人が多いので、手順も出す
      return (
        <Notice {...PERMISSION_DENIED}>
          <ol className="steps">
            <li>画面の下から上にスワイプして、少し止める</li>
            <li>ブラウザを上にスワイプして終了する</li>
            <li>QR コードを読み取り直し、「参加」→「許可」を押す</li>
          </ol>
        </Notice>
      );
    case "unsupported":
      return <Notice {...UNSUPPORTED} />;
    case "checking-tilt":
    case "connecting":
      return <Waiting title="つないでいます" />;
    case "rejected":
      return <Notice {...REJECT_NOTICES[state.reason]} />;
    case "closed":
      return <Notice {...CLOSED[state.replaced ? "replaced" : "lost"]} />;
    case "joined":
      return (
        <>
          <Joined state={state} inert={state.reconnectingSince !== undefined} />
          {state.reconnectingSince !== undefined ? (
            <Reconnecting joint={state.joint} since={state.reconnectingSince} />
          ) : null}
        </>
      );
  }
}

function Joined({
  state,
  inert,
}: {
  state: Extract<PhoneState, { kind: "joined" }>;
  /** つなぎ直しの画面を上に重ねているあいだ、下の画面を押せなくする */
  inert: boolean;
}) {
  const label = JOINT_LABELS[state.joint];
  const playing = state.phase.kind === "playing";
  return (
    <div className="joined" data-active={playing && state.active} inert={inert}>
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

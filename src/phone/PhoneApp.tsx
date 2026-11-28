import { useCallback, useEffect, useReducer, useRef } from "react";
import { Entry } from "./Entry.tsx";
import { JointBand } from "./JointBand.tsx";
import { Lobby } from "./Lobby.tsx";
import { initialState, reduce, type PhoneState, type RejectReason } from "./model.ts";
import { Playing } from "./Playing.tsx";
import { Reconnecting } from "./Reconnecting.tsx";
import { Result } from "./Result.tsx";
import { startSession } from "./session.ts";
import { Notice, Waiting } from "./templates.tsx";
import { requestTiltPermission, waitForTilt } from "./tilt.ts";

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

export function PhoneApp({ room }: { room: string | undefined }) {
  const [state, dispatch] = useReducer(reduce, room, initialState);
  const session = useRef<ReturnType<typeof startSession> | undefined>(undefined);

  // ページを閉じるとき（と開発中の再読み込み）に、接続を閉じる
  useEffect(() => () => session.current?.stop(), []);

  const start = useCallback(() => {
    session.current?.send({ type: "start" });
  }, []);
  const retry = useCallback(() => {
    session.current?.send({ type: "retry" });
  }, []);

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
    session.current?.stop();
    session.current = startSession(room, dispatch);
  };

  return (
    <main className="app">
      {state.kind !== "joined" ? (
        <header className="top">
          <span className="brand">ふにゃおじ</span>
          {room !== undefined ? <span className="room">ルームコード {room}</span> : null}
        </header>
      ) : null}
      <Body state={state} room={room} onJoin={join} onStart={start} onRetry={retry} />
    </main>
  );
}

function Body({
  state,
  room,
  onJoin,
  onStart,
  onRetry,
}: {
  state: PhoneState;
  room: string | undefined;
  onJoin: () => void;
  onStart: () => void;
  onRetry: () => void;
}) {
  switch (state.kind) {
    case "invalid-room":
      return <Notice {...REJECT_NOTICES["no-room"]} />;
    case "ready":
    case "asking-permission":
      return <Entry askingPermission={state.kind === "asking-permission"} onJoin={onJoin} />;
    case "permission-denied":
      // iOS は、ブラウザを開き直すまで許可の画面を出さない。開き直し方を知らない人が多いので、手順も出す
      return (
        <Notice {...PERMISSION_DENIED}>
          <ol className="steps">
            <li>画面の下から上にスワイプして、少し止める</li>
            <li>ブラウザを上にスワイプして終了する</li>
            <li>QR コードを読み取り直し、「参加する」→「許可」を押す</li>
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
    case "ended":
      return (
        <>
          {state.joint && <JointBand joint={state.joint} />}
          <Notice
            title="このルームは終了しました"
            reason="遊んでくれてありがとう！"
            next="また遊ぶときは、スクリーンのQRを読み取ってください。"
          />
        </>
      );
    case "closed":
      return <Notice {...CLOSED[state.replaced ? "replaced" : "lost"]} />;
    case "joined":
      return (
        <>
          <div className="joined" inert={state.reconnectingSince !== undefined}>
            {state.phase.kind === "lobby" ? (
              <Lobby room={room} joint={state.joint} count={state.count} onStart={onStart} />
            ) : state.phase.kind === "playing" ? (
              <Playing joint={state.joint} active={state.active} />
            ) : (
              <Result
                joint={state.joint}
                result={state.phase.result}
                count={state.count}
                onRetry={onRetry}
              />
            )}
          </div>
          {state.reconnectingSince !== undefined ? (
            // since が変わった直後に、古い残り秒数を出さないよう作り直す
            <Reconnecting
              key={state.reconnectingSince}
              joint={state.joint}
              since={state.reconnectingSince}
            />
          ) : null}
        </>
      );
  }
}

// ルームにつないでいるあいだ、React の外でやること：接続、tilt の送信、画面を消さないこと
import { connectPhone } from "../net/client.ts";
import { createTiltSeq, phoneClientId } from "../net/phone.ts";
import type { Joint, ReadyMessage, RetryMessage, StartMessage } from "../shared/messages.ts";
import { RECONNECT_GRACE_MS, type PhoneEvent } from "./model.ts";
import { startReadingTilt, startSendingTilt } from "./tilt.ts";
import { holdWakeLock } from "./wakeLock.ts";

/** つながっているあいだ、ページが動いている時刻を覚える間隔 */
const ALIVE_INTERVAL_MS = 1_000;

interface PhoneSession {
  stop(): void;
  send(message: StartMessage | RetryMessage | ReadyMessage): boolean;
}

/** ルームにつなぐ。stop でつなぎ直しも含めて終了する */
export function startSession(room: string, emit: (event: PhoneEvent) => void): PhoneSession {
  const stopReading = startReadingTilt();
  const nextSeq = createTiltSeq();
  let stopSending: (() => void) | undefined;
  let releaseWakeLock: (() => void) | undefined;
  /** いまの接続で joined を受け取った。つなぎ直したら、また joined が届くまで false */
  let joined = false;
  /**
   * 最後に、つながっていてページが動いていた時刻。画面のロックなどでページが止まると、止まる前の時刻のまま残る。
   * 止まっているあいだもサーバーは関節を取っておく60秒を数えるので、つなぎ直しの残り秒数はこの時刻から数える
   */
  let aliveAt = Date.now();
  /** サーバーに関節を渡されている（joined を受け取ってから、断られるまで） */
  let holdingJoint = false;
  /** joined で渡された関節 */
  let joint: Joint | undefined;
  /** 遊び方の間に準備OK を送ろうとした。届いた howto に自分の関節が無ければ送り直す */
  let readyAttempted = false;
  /** joined から room までのあいだ。サーバーが保持している phase と howto を送り直している */
  let replaying = false;
  let howtoReplayed = false;
  /** つなぎ直しの残り秒数を数え始めた時刻。ここから60秒で諦める */
  let reconnectingSince: number | undefined;
  let giveUp: ReturnType<typeof setTimeout> | undefined;

  const stopCountdown = () => {
    clearTimeout(giveUp);
    giveUp = undefined;
    reconnectingSince = undefined;
  };
  const deadlinePassed = () =>
    reconnectingSince !== undefined && Date.now() >= reconnectingSince + RECONNECT_GRACE_MS;

  const connection = connectPhone(
    room,
    {
      onMessage(message) {
        const at = performance.now();
        if (message.type === "joined") {
          joined = true;
          holdingJoint = true;
          if (joint !== message.joint) readyAttempted = false;
          joint = message.joint;
          replaying = true;
          howtoReplayed = false;
          // サーバーが関節を返したので、room を待つあいだに60秒を過ぎても切らない
          stopCountdown();
          releaseWakeLock ??= holdWakeLock();
        } else if (message.type === "rejected") {
          joined = false;
          holdingJoint = false;
          readyAttempted = false;
          stopCountdown();
          releaseWakeLock?.();
          releaseWakeLock = undefined;
        } else if (message.type === "phase") {
          // 送り直しの lobby のあとには、遊び方の間なら howto が続く
          if (!replaying || message.phase !== "lobby") readyAttempted = false;
        } else if (message.type === "howto") {
          howtoReplayed ||= replaying;
          // つなぎ直す直前に送った ready が失われていたら、送り直す。スクリーンは同じ関節を2回数えない
          if (readyAttempted && joined && joint !== undefined && !message.ready.includes(joint)) {
            connection.send({ type: "ready" });
          }
        } else if (message.type === "room") {
          // 切れているあいだに遊び方が終わっていた
          if (replaying && !howtoReplayed) readyAttempted = false;
          replaying = false;
        }
        emit({ type: "message", message, at });
      },
      onStateChange(state) {
        stopSending?.();
        stopSending = undefined;
        joined = false;
        if (state.status === "closed") {
          stopCountdown();
          stopReading();
          releaseWakeLock?.();
          releaseWakeLock = undefined;
        }
        if (state.status === "reconnecting" && holdingJoint && reconnectingSince === undefined) {
          reconnectingSince = aliveAt;
          // 残り秒数が 0 になる時刻に諦める。開いている途中は切らない（関節を返されたあとに切ると、また60秒予約させる）
          giveUp = setTimeout(
            () => connection.checkReconnect(),
            Math.max(0, reconnectingSince + RECONNECT_GRACE_MS - Date.now()),
          );
        }
        // 送るのは、つながっていて、参加できているあいだだけ
        if (state.status === "open") {
          stopSending = startSendingTilt(nextSeq, (message) => joined && connection.send(message));
          aliveAt = Date.now();
        }
        const at = state.status === "reconnecting" ? (reconnectingSince ?? aliveAt) : Date.now();
        emit({ type: "connection", state, at });
      },
    },
    {
      baseUrl: location.href,
      clientId: phoneClientId(),
      // 予約が切れてからつなぐと別の関節を取り、閉じるとそれを60秒予約させる。
      // 止まっていたページはタイマーより先につなぎ直すので、つなぐ前にも見る
      shouldReconnect: () => !deadlinePassed(),
    },
  );
  let lastTick = Date.now();
  const alive = setInterval(() => {
    const now = Date.now();
    // 前の回から間があいたら、ページが止まっていた。戻った直後に、止まる前の時刻を上書きしない
    const resumed = now - lastTick > ALIVE_INTERVAL_MS * 3;
    lastTick = now;
    if (!resumed && connection.state.status === "open") aliveAt = now;
  }, ALIVE_INTERVAL_MS);

  return {
    stop() {
      clearInterval(alive);
      stopCountdown();
      connection.close();
      stopSending?.();
      releaseWakeLock?.();
      stopReading();
    },
    send(message) {
      if (message.type === "ready") readyAttempted = true;
      return joined && connection.send(message);
    },
  };
}

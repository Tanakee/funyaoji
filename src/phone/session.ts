// ルームにつないでいるあいだ、React の外でやること：接続、入力（傾きかカメラ）の読み取りと tilt の送信、画面を消さないこと
import { connectPhone } from "../net/client.ts";
import { createTiltSeq, phoneClientId, renewPhoneClientId } from "../net/phone.ts";
import type {
  InputMethod,
  Joint,
  ReadyMessage,
  RetryMessage,
  StartMessage,
} from "../shared/messages.ts";
import { startCamera } from "./camera/camera.ts";
import { RECONNECT_GRACE_MS, type PhoneEvent } from "./model.ts";
import { setLatestAngle, startReadingTilt, startSendingTilt } from "./tilt.ts";
import { holdWakeLock } from "./wakeLock.ts";

/** つながっているあいだ、ページが動いている時刻を覚える間隔 */
const ALIVE_INTERVAL_MS = 1_000;

interface PhoneSession {
  stop(): void;
  leave(): void;
  /**
   * 順番待ちをやめる。参加列から抜けたことをサーバーに知らせてから閉じる。列の位置を予約させない。
   * 切れていて知らせられなければ、ID を作り直す。サーバーに残った列の位置を、次に参加したときに引き継がない
   */
  withdraw(): void;
  send(message: StartMessage | RetryMessage | ReadyMessage): boolean;
  /** 操作方法を切り替える。スクリーンが phase で知らせてくる。同じものなら何もしない */
  setInput(input: InputMethod): void;
}

function startReading(input: InputMethod): () => void {
  return input === "camera" ? startCamera(setLatestAngle) : startReadingTilt();
}

/** ルームにつなぐ。stop でつなぎ直しも含めて終了する */
export function startSession(room: string, emit: (event: PhoneEvent) => void): PhoneSession {
  // 参加したときは傾き。スクリーンがカメラを選んでいれば、phase を受け取ってから切り替える
  let input: InputMethod | undefined = "tilt";
  let stopInput = startReading(input);
  const stopReading = () => {
    stopInput();
    stopInput = () => {};
    input = undefined;
  };
  const nextSeq = createTiltSeq();
  let stopSending: (() => void) | undefined;
  let releaseWakeLock: (() => void) | undefined;
  /** いまの接続で joined を受け取った。つなぎ直したら、また joined が届くまで false */
  let joined = false;
  let leaving = false;
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
        } else if (message.type === "rejected" || message.type === "queued") {
          joined = false;
          holdingJoint = false;
          readyAttempted = false;
          // 参加列に並んだら、サーバーが列の位置を持っているので、60秒で諦めない。
          // 参加していたスマホも、そのまま列で待つ（docs/api.md の「つなぎ直し」）
          stopCountdown();
          releaseWakeLock?.();
          releaseWakeLock = undefined;
        } else if (message.type === "phase") {
          // 送り直しの lobby のあとには、遊び方の間なら howto が続く
          if (!replaying || message.phase !== "lobby") readyAttempted = false;
        } else if (message.type === "howto") {
          howtoReplayed ||= replaying;
          // つなぎ直す直前に送った ready が失われていたら、送り直す。スクリーンは同じ関節を2回数えない
          if (
            readyAttempted &&
            joined &&
            !leaving &&
            joint !== undefined &&
            !message.ready.includes(joint)
          ) {
            connection.send({ type: "ready" });
          }
        } else if (message.type === "room") {
          // 切れているあいだに遊び方が終わっていた
          if (replaying && !howtoReplayed) readyAttempted = false;
          replaying = false;
        }
        emit({ type: "message", message, at });
        if (leaving && message.type === "joined") connection.send({ type: "leave" });
        // 抜けるを押したあとに列に並べられたら、列からも抜ける。left が届いて終わる
        if (leaving && message.type === "queued") connection.send({ type: "leave" });
        if (leaving && message.type === "rejected") connection.close();
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
    withdraw() {
      if (!connection.send({ type: "leave" })) renewPhoneClientId();
      this.stop();
    },
    leave() {
      if (leaving) return;
      leaving = true;
      if (joined) connection.send({ type: "leave" });
    },
    send(message) {
      if (leaving) return false;
      if (message.type === "ready") readyAttempted = true;
      return joined && connection.send(message);
    },
    setInput(next) {
      // 閉じたあとは読み直さない
      if (input === undefined || next === input) return;
      stopInput();
      input = next;
      stopInput = startReading(next);
    },
  };
}

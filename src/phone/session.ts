// ルームにつないでいるあいだ、React の外でやること：接続、tilt の送信、画面を消さないこと
import { connectPhone } from "../net/client.ts";
import { createTiltSeq, phoneClientId } from "../net/phone.ts";
import type { PhoneEvent } from "./model.ts";
import { startReadingTilt, startSendingTilt } from "./tilt.ts";
import { holdWakeLock } from "./wakeLock.ts";

/** つながっているあいだ、ページが動いている時刻を覚える間隔 */
const ALIVE_INTERVAL_MS = 1_000;

/** ルームにつなぐ。戻り値で、つなぎ直しも含めて全部やめる */
export function startSession(room: string, emit: (event: PhoneEvent) => void): () => void {
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

  const connection = connectPhone(
    room,
    {
      onMessage(message) {
        if (message.type === "joined") {
          joined = true;
          releaseWakeLock ??= holdWakeLock();
        } else if (message.type === "rejected") {
          joined = false;
          releaseWakeLock?.();
          releaseWakeLock = undefined;
        }
        emit({ type: "message", message });
      },
      onStateChange(state) {
        stopSending?.();
        stopSending = undefined;
        joined = false;
        if (state.status === "closed") {
          releaseWakeLock?.();
          releaseWakeLock = undefined;
        }
        // 送るのは、つながっていて、参加できているあいだだけ
        if (state.status === "open") {
          stopSending = startSendingTilt(nextSeq, (message) => joined && connection.send(message));
          aliveAt = Date.now();
        }
        const at = state.status === "reconnecting" ? aliveAt : Date.now();
        emit({ type: "connection", state, at });
      },
    },
    { baseUrl: location.href, clientId: phoneClientId() },
  );
  let lastTick = Date.now();
  const alive = setInterval(() => {
    const now = Date.now();
    // 前の回から間があいたら、ページが止まっていた。戻った直後に、止まる前の時刻を上書きしない
    const resumed = now - lastTick > ALIVE_INTERVAL_MS * 3;
    lastTick = now;
    if (!resumed && connection.state.status === "open") aliveAt = now;
  }, ALIVE_INTERVAL_MS);

  return () => {
    clearInterval(alive);
    connection.close();
    stopSending?.();
    releaseWakeLock?.();
    stopReading();
  };
}

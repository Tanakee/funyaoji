// ルームにつないでいるあいだ、React の外でやること：接続、tilt の送信、画面を消さないこと
import { connectPhone } from "../net/client.ts";
import { createTiltSeq, phoneClientId } from "../net/phone.ts";
import type { PhoneEvent } from "./model.ts";
import { startReadingTilt, startSendingTilt } from "./tilt.ts";
import { holdWakeLock } from "./wakeLock.ts";

/** ルームにつなぐ。戻り値で、つなぎ直しも含めて全部やめる */
export function startSession(room: string, emit: (event: PhoneEvent) => void): () => void {
  const stopReading = startReadingTilt();
  const nextSeq = createTiltSeq();
  let stopSending: (() => void) | undefined;
  let releaseWakeLock: (() => void) | undefined;
  /** いまの接続で joined を受け取った。つなぎ直したら、また joined が届くまで false */
  let joined = false;

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
          stopReading();
          releaseWakeLock?.();
          releaseWakeLock = undefined;
        }
        // 送るのは、つながっていて、参加できているあいだだけ
        if (state.status === "open") {
          stopSending = startSendingTilt(nextSeq, (message) => joined && connection.send(message));
        }
        emit({ type: "connection", state });
      },
    },
    { baseUrl: location.href, clientId: phoneClientId() },
  );

  return () => {
    connection.close();
    stopSending?.();
    releaseWakeLock?.();
    stopReading();
  };
}

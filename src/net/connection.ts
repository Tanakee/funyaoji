import type * as v from "valibot";
import {
  HEARTBEAT,
  ROOM_CLOSED_CODE,
  LEFT_CODE,
  HEARTBEAT_INTERVAL_MS,
  type HeartbeatMessage,
  type RejectedMessage,
} from "../shared/messages.ts";
import { parseMessage } from "../shared/parse.ts";
import type { OpenTransport, Transport } from "./transport.ts";

/**
 * 接続の状態。
 * - connecting：初めてつないでいる
 * - open：つながっている
 * - reconnecting：切れたので、つなぎ直している。attempt は、最後につながってから何回目のつなぎ直しか（1から）
 * - closed：閉じた。もうつなぎ直さない。code はトランスポートの close コードで、こちらから閉じたときは 1000
 */
export type ConnectionState =
  | { status: "connecting" }
  | { status: "open" }
  | { status: "reconnecting"; attempt: number }
  | { status: "closed"; code: number; reason: string };

/** サーバーとの接続。切れたら、同じ相手に自動でつなぎ直す（docs/api.md の「つなぎ直し」） */
export interface Connection<Send> {
  /** 開いていれば送って true を返す。開いていなければ送らずに false を返す */
  send(message: Send): boolean;
  /** 閉じる。もうつなぎ直さない */
  close(): void;
  /**
   * つなぎ直すのを待っているなら、shouldReconnect を聞き直し、false なら閉じる。
   * トランスポートを開いている途中なら、その結果を待つ（切れたら、つなぎ直す前に聞く）
   */
  checkReconnect(): void;
  readonly state: ConnectionState;
}

export interface ConnectOptions<Receive extends { type: string }> {
  /** トランスポートを開く。つなぎ直すたびに呼ぶ */
  open: OpenTransport;
  /** 受信したメッセージを検証するスキーマ。合わないメッセージは捨てる */
  schema: v.GenericSchema<unknown, Receive>;
  /** 検証したメッセージ。ハートビートの返事は渡さない */
  onMessage: (message: Exclude<Receive, HeartbeatMessage>) => void;
  onStateChange?: (state: ConnectionState) => void;
  /**
   * 切れてつなぎ直すときと、トランスポートを開く前に聞く。false なら開かずに閉じる（code は 1000）。
   * 省くと諦めない。初めの接続では聞かない
   */
  shouldReconnect?: () => boolean;
}

/** こちらから閉じたときの close コード */
const NORMAL_CLOSURE = 1000;
/** サーバーが、新しいスクリーンに置き換えて閉じたときの close コード */
const REPLACED = 4000;
/** これで断られたら、つなぎ直しても入れない */
const FINAL_REJECTIONS: readonly RejectedMessage["reason"][] = ["no-room", "full"];

/** ブラウザの document のうち、使うところだけ。Node.js（scripts/fake-phone.ts）には無い */
interface Page {
  readonly visibilityState: string;
  addEventListener(type: "visibilitychange", listener: () => void): void;
  removeEventListener(type: "visibilitychange", listener: () => void): void;
}
const page = (globalThis as { document?: Page }).document;

/** つなぎ直すまでに待つ時間。n 回目は n 番目、それより後は最後の値 */
export const RECONNECT_DELAYS_MS = [1_000, 2_000, 4_000, 8_000, 10_000] as const;
/** ハートビートの返事もほかのメッセージもこの時間届かなければ、切れたとみなす */
export const LIVENESS_TIMEOUT_MS = 10_000;

/**
 * トランスポートを開き、受信したメッセージを検証して渡す。
 * 開いているあいだ、5秒ごとにハートビートを送る（docs/api.md の heartbeat）。
 * 思いがけず切れたときと、10秒何も届かないときは、つなぎ直す
 */
export function connect<Receive extends { type: string }, Send>(
  options: ConnectOptions<Receive>,
): Connection<Send> {
  let state: ConnectionState = { status: "connecting" };
  let transport: Transport;
  /** いまのトランスポートの番号。古いトランスポートから届いた出来事を捨てるのに使う */
  let generation = 0;
  /** 最後につながってから、つなぎ直した回数 */
  let attempt = 0;
  /** つなぎ直しても入れない理由で断られた */
  let finalRejection = false;
  let lastReceivedAt = 0;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let liveness: ReturnType<typeof setTimeout> | undefined;
  let retry: ReturnType<typeof setTimeout> | undefined;

  const setState = (next: ConnectionState) => {
    state = next;
    options.onStateChange?.(next);
  };
  const stopTimers = () => {
    clearInterval(heartbeat);
    clearTimeout(liveness);
    clearTimeout(retry);
    heartbeat = liveness = retry = undefined;
  };

  // 何か届くたびにタイマーを置き直すと、tilt のたびに置き直すことになる。届いた時刻だけを覚え、期限に見直す
  const watchLiveness = () => {
    clearTimeout(liveness);
    const remaining = lastReceivedAt + LIVENESS_TIMEOUT_MS - Date.now();
    if (remaining <= 0) {
      liveness = undefined;
      dropAndReconnect();
      return;
    }
    liveness = setTimeout(watchLiveness, remaining);
  };

  /** もうつなぎ直さない */
  const finish = (code: number, reason: string) => {
    stopTimers();
    removeVisibilityListener();
    setState({ status: "closed", code, reason });
  };

  /** いまのトランスポートを捨てて、つなぎ直す。断られたあとに閉じられないまま黙ったときは、つなぎ直さない */
  const dropAndReconnect = () => {
    generation++;
    clearInterval(heartbeat);
    heartbeat = undefined;
    transport.close();
    if (finalRejection) finish(NORMAL_CLOSURE, "");
    else scheduleReconnect();
  };

  const scheduleReconnect = () => {
    clearTimeout(liveness);
    liveness = undefined;
    if (options.shouldReconnect?.() === false) {
      finish(NORMAL_CLOSURE, "");
      return;
    }
    attempt++;
    const delays = RECONNECT_DELAYS_MS;
    const delay = delays[Math.min(attempt, delays.length) - 1];
    retry = setTimeout(() => {
      retry = undefined;
      reopen();
    }, delay);
    setState({ status: "reconnecting", attempt });
  };

  const reopen = () => {
    if (options.shouldReconnect?.() === false) finish(NORMAL_CLOSURE, "");
    else open();
  };

  const open = () => {
    const current = ++generation;
    lastReceivedAt = Date.now();
    // 開くまでに10秒かかったときも、切れたとみなす
    watchLiveness();
    transport = options.open({
      onOpen() {
        if (current !== generation) return;
        lastReceivedAt = Date.now();
        // 先にタイマーを置く。onStateChange の中で close() されても、そこで止められる
        heartbeat = setInterval(() => transport.send(HEARTBEAT), HEARTBEAT_INTERVAL_MS);
        setState({ status: "open" });
      },
      onMessage(data) {
        if (current !== generation || state.status !== "open") return;
        lastReceivedAt = Date.now();
        const message = parseMessage(options.schema, data);
        if (message === undefined) return;
        if (message.type === "rejected") {
          const { reason } = message as unknown as RejectedMessage;
          if (FINAL_REJECTIONS.includes(reason)) finalRejection = true;
        } else {
          // 断られずに受け取れたら、次に切れたときは1秒から待ち直す。
          // playing で断られ続けているあいだは、待つ時間を延ばしていく
          attempt = 0;
        }
        if (message.type === "room-closed" || message.type === "left") {
          finalRejection = true;
          // close フレームを待たず、通知だけでも再接続とタイマーを止める。
          stopTimers();
          generation++;
          options.onMessage(message as Exclude<Receive, HeartbeatMessage>);
          transport.close();
          finish(message.type === "left" ? LEFT_CODE : ROOM_CLOSED_CODE, message.type);
          return;
        }
        if (message.type === "heartbeat") return;
        options.onMessage(message as Exclude<Receive, HeartbeatMessage>);
      },
      onClose({ code, reason }) {
        if (current !== generation) return;
        clearInterval(heartbeat);
        heartbeat = undefined;
        if (state.status === "closed") return;
        if (
          finalRejection ||
          code === REPLACED ||
          code === ROOM_CLOSED_CODE ||
          code === LEFT_CODE
        ) {
          finish(code, reason);
        } else {
          scheduleReconnect();
        }
      },
    });
  };

  // 裏に回ったタブではタイマーが遅れる。表に戻ったら、待たずにつなぎ直す
  const onVisibilityChange = () => {
    if (page?.visibilityState !== "visible") return;
    if (retry !== undefined) {
      clearTimeout(retry);
      retry = undefined;
      attempt = 0;
      reopen();
    } else if (liveness !== undefined) {
      watchLiveness();
    }
  };
  const removeVisibilityListener = () => {
    page?.removeEventListener("visibilitychange", onVisibilityChange);
  };
  page?.addEventListener("visibilitychange", onVisibilityChange);

  open();

  return {
    send(message) {
      if (state.status !== "open") return false;
      return transport.send(JSON.stringify(message));
    },
    close() {
      stopTimers();
      removeVisibilityListener();
      if (state.status === "closed") return;
      // 閉じ終わるのを待たずに閉じたことにする。あとから届くメッセージと close は捨てる
      generation++;
      const closed: ConnectionState = { status: "closed", code: NORMAL_CLOSURE, reason: "" };
      state = closed;
      // 知らせる前にトランスポートを閉じる。onStateChange が例外を投げたり、プロセスを終えたりしても、閉じ損ねない
      try {
        transport.close();
      } finally {
        options.onStateChange?.(closed);
      }
    },
    checkReconnect() {
      if (retry === undefined || options.shouldReconnect?.() !== false) return;
      finish(NORMAL_CLOSURE, "");
    },
    get state() {
      return state;
    },
  };
}

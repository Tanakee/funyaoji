import {
  connectScreen,
  type Connection,
  type ScreenHandlers,
  type ScreenReceived,
  type ScreenSent,
} from "../../net/client.ts";

/** QR を公開する前に、新ルームにつながり room を受け取れたことを確かめる。 */
export interface PreparedScreen {
  connection: Connection<ScreenSent>;
  activate(handlers: ScreenHandlers): void;
  discard(): void;
}

export function prepareScreen(roomCode: string, signal: AbortSignal): Promise<PreparedScreen> {
  return new Promise((resolve, reject) => {
    let delegate: ScreenHandlers | undefined;
    const messages: ScreenReceived[] = [];
    let ready = false;
    let finished = false;
    let connection: Connection<ScreenSent>;
    const timer = setTimeout(() => fail(new Error("新しいルームにつながりませんでした")), 10_000);
    const cleanup = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
    };
    const discard = () => {
      if (finished) return;
      finished = true;
      cleanup();
      connection.send({ type: "close-room" });
      connection.close();
    };
    const fail = (error: Error) => {
      discard();
      reject(error);
    };
    const abort = () => fail(new Error("ルームの作成を中止しました"));
    connection = connectScreen(
      roomCode,
      {
        onStateChange(state) {
          if (finished) return;
          if (delegate) delegate.onStateChange?.(state);
          else if (state.status === "closed") fail(new Error("新しいルームへの接続が終了しました"));
        },
        onLatency(latency) {
          if (!finished) delegate?.onLatency?.(latency);
        },
        onMessage(message) {
          if (finished) return;
          if (delegate) {
            delegate.onMessage(message);
            return;
          }
          if (message.type === "rejected" || message.type === "room-closed") {
            fail(new Error("新しいルームに参加できませんでした"));
            return;
          }
          messages.push(message);
          if (!ready && message.type === "room" && message.roomCode === roomCode) {
            ready = true;
            clearTimeout(timer);
            resolve({
              connection,
              discard,
              activate(handlers) {
                if (finished) return;
                cleanup();
                delegate = handlers;
                handlers.onStateChange?.(connection.state);
                for (const buffered of messages) handlers.onMessage(buffered);
                messages.length = 0;
              },
            });
          }
        },
      },
      { baseUrl: location.href },
    );
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
  });
}

import type { OpenTransport } from "./transport.ts";

/** こちらから閉じるときの close コード */
const NORMAL_CLOSURE = 1000;
/** つながらなかったときの close コード（WebSocket の仕様の 1006） */
const ABNORMAL_CLOSURE = 1006;

/** WebSocket のトランスポート。url は ws: か wss: */
export function webSocketTransport(url: string | URL): OpenTransport {
  return (handlers) => {
    const ws = new WebSocket(url);
    let closed = false;
    const reportClose = (code: number, reason: string) => {
      if (closed) return;
      closed = true;
      handlers.onClose({ code, reason });
    };
    ws.addEventListener("open", () => handlers.onOpen());
    ws.addEventListener("message", (event) => {
      if (typeof event.data === "string") handlers.onMessage(event.data);
    });
    ws.addEventListener("close", (event) => reportClose(event.code, event.reason));
    // Node.js の WebSocket は、つながらなかったときに error だけを出し、close を出さないことがある
    ws.addEventListener("error", () => {
      if (ws.readyState !== WebSocket.OPEN) reportClose(ABNORMAL_CLOSURE, "");
    });
    return {
      send(data) {
        if (ws.readyState !== WebSocket.OPEN) return false;
        ws.send(data);
        return true;
      },
      close() {
        if (ws.readyState === WebSocket.CONNECTING || ws.readyState === WebSocket.OPEN) {
          ws.close(NORMAL_CLOSURE);
        }
      },
    };
  };
}

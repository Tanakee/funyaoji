// テスト用のトランスポート。開く・受信する・閉じるを、テストから起こせる
import type { CloseInfo, OpenTransport, TransportHandlers } from "./transport.ts";

export class FakeTransport {
  /** 送った文字列 */
  readonly sent: string[] = [];
  /** 開いた URL（client.ts から開いたとき） */
  url: URL | undefined;
  closeCalls = 0;
  private handlers: TransportHandlers | undefined;
  private isOpen = false;

  /** connect に渡す関数 */
  readonly open: OpenTransport = (handlers) => {
    this.handlers = handlers;
    return {
      send: (data) => {
        if (!this.isOpen) return false;
        this.sent.push(data);
        return true;
      },
      close: () => {
        this.closeCalls++;
      },
    };
  };

  /** client.ts の transport に渡す関数 */
  readonly factory = (url: URL): OpenTransport => {
    this.url = url;
    return this.open;
  };

  emitOpen(): void {
    this.isOpen = true;
    this.requireHandlers().onOpen();
  }

  emitMessage(message: unknown): void {
    this.requireHandlers().onMessage(
      typeof message === "string" ? message : JSON.stringify(message),
    );
  }

  emitClose(info: CloseInfo): void {
    this.isOpen = false;
    this.requireHandlers().onClose(info);
  }

  private requireHandlers(): TransportHandlers {
    if (!this.handlers) throw new Error("トランスポートが開かれていません");
    return this.handlers;
  }
}

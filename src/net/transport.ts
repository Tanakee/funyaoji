// メッセージを運ぶ手段（WebSocket など）のインターフェース。
// 接続（connection.ts）は文字列を送り受けするだけで、どのトランスポートかを知らない

/** トランスポートが閉じたときの close コードと理由 */
export interface CloseInfo {
  code: number;
  reason: string;
}

/** トランスポートが知らせる出来事 */
export interface TransportHandlers {
  onOpen(): void;
  onMessage(data: string): void;
  /** 閉じた。1回だけ呼ぶ。開く前につながらなかったときも呼ぶ */
  onClose(info: CloseInfo): void;
}

export interface Transport {
  /** 開いていれば送って true を返す。開いていなければ送らずに false を返す */
  send(data: string): boolean;
  /** 閉じる。閉じ終わったら onClose を呼ぶ */
  close(): void;
}

/** トランスポートを開く関数。開き始めたトランスポートを返し、出来事を handlers に知らせる */
export type OpenTransport = (handlers: TransportHandlers) => Transport;

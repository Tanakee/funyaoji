import { DurableObject } from "cloudflare:workers";

export class Room extends DurableObject {
  async countCall(): Promise<number> {
    const count = (this.ctx.storage.kv.get<number>("count") ?? 0) + 1;
    this.ctx.storage.kv.put("count", count);
    return count;
  }

  override fetch(): Response {
    const { 0: client, 1: server } = new WebSocketPair();
    this.ctx.acceptWebSocket(server);
    return new Response(null, { status: 101, webSocket: client });
  }

  override webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): void {
    ws.send(message);
  }
}
